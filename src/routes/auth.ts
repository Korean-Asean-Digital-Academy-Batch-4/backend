import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";

import { BATAS_MASUK, BATAS_MASUK_IP, JENDELA_MASUK_MS } from "../domain/pembatas-laju.js";
import { cariPenggunaUntukMasuk } from "../db/akun.js";
import type { BasisData } from "../db/drizzle.js";
import { catatKegagalan, hapusPenghitung, periksaBatas } from "../db/pembatas-laju.js";
import { UMUR_SESI_MS } from "../domain/sesi.js";
import { buatSesiJikaHashTetap, cabutSesi } from "../db/sesi.js";
import type { KataSandi } from "../ports/kata-sandi.js";
import { KODE, PESAN_KREDENSIAL_SALAH, kirimData, kirimKesalahan } from "./amplop.js";
import { alamatKlien } from "./alamat-ip.js";
import { bungkus } from "./bungkus.js";
import { NAMA_COOKIE_SESI, wajibMasuk } from "./middleware-sesi.js";
import { bentukKonteks } from "./saya.js";

/**
 * Masuk dan keluar — API.md §3.1 dan §3.2.
 *
 * **Tidak ada endpoint lupa kata sandi.** Tombolnya ada di halaman masuk tetapi
 * hanya menampilkan pesan statis di frontend, tanpa memanggil apa pun —
 * pemenuhan AC-33. Endpoint yang menerima nama pengguna, sekalipun hanya
 * menjawab pesan tetap, akan menjadi jalur pengungkapan akun yang tidak diminta
 * siapa pun.
 */

// Panjang 1–128, tanpa syarat kerumitan apa pun — PRD §6.1.3, API.md §2.7.
// Ketiadaan syarat kerumitan disengaja, bukan terlupa.
const kataSandiSkema = z.string().min(1).max(128);

// `.strict()` menolak bidang yang tidak dikenal alih-alih mengabaikannya, supaya
// salah ketik nama bidang muncul sebagai kegagalan — API.md §2.7.
const masukSkema = z
  .object({ nama_pengguna: z.string().min(1).max(32), kata_sandi: kataSandiSkema })
  .strict();

export function rutaAuth(pool: Pool, db: BasisData, kataSandi: KataSandi): Router {
  const ruta = Router();

  ruta.post(
    "/api/auth/masuk",
    bungkus(async (req, res) => {
      const badan = masukSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Nama pengguna dan kata sandi wajib diisi.",
        );
        return;
      }

      const sekarang = new Date();
      const kunci = `login:pengguna:${badan.data.nama_pengguna.toLowerCase()}`;
      const kunciIp = `login:ip:${alamatKlien(req.headers["x-forwarded-for"] as string | undefined, req.socket.remoteAddress)}`;

      // Dua lapis, CK-A-08. Yang pertama menahan serangan atas satu akun; yang
      // kedua menahan penyemprotan satu kata sandi atas ratusan akun, yang tidak
      // pernah menyentuh batas per akun karena tiap akun hanya gagal sekali.
      const batasAkun = await periksaBatas(pool, kunci, sekarang, BATAS_MASUK, JENDELA_MASUK_MS);
      const batasIp = await periksaBatas(pool, kunciIp, sekarang, BATAS_MASUK_IP, JENDELA_MASUK_MS);
      const batas = !batasAkun.boleh ? batasAkun : batasIp;
      if (!batas.boleh) {
        kirimKesalahan(
          res,
          429,
          KODE.batasLajuTerlampaui,
          "Terlalu banyak percobaan masuk. Silakan coba lagi beberapa saat lagi.",
          [{ coba_lagi_pada: batas.cobaLagiPada.toISOString() }],
        );
        return;
      }

      const akun = await cariPenggunaUntukMasuk(pool, badan.data.nama_pengguna);

      // Akun yang tidak ada tetap melewati satu verifikasi Argon2id, sehingga
      // lama jawabannya tidak membedakannya dari akun yang ada (API.md §3.1).
      const cocok = akun
        ? await kataSandi.verifikasi(akun.kataSandiHash, badan.data.kata_sandi)
        : await kataSandi.verifikasiTiruan(badan.data.kata_sandi);

      // Akun nonaktif ditolak dengan kode dan teks yang sama persis.
      if (!akun || !akun.aktif || !cocok) {
        await catatKegagalan(pool, kunci, sekarang, JENDELA_MASUK_MS);
        await catatKegagalan(pool, kunciIp, sekarang, JENDELA_MASUK_MS);
        kirimKesalahan(res, 401, KODE.kredensialSalah, PESAN_KREDENSIAL_SALAH);
        return;
      }

      const sesi = await buatSesiJikaHashTetap(db, akun.id, akun.kataSandiHash, sekarang);
      if (!sesi) {
        await catatKegagalan(pool, kunci, sekarang, JENDELA_MASUK_MS);
        await catatKegagalan(pool, kunciIp, sekarang, JENDELA_MASUK_MS);
        kirimKesalahan(res, 401, KODE.kredensialSalah, PESAN_KREDENSIAL_SALAH);
        return;
      }

      // Hanya penghitung akun yang dibersihkan setelah sesi benar-benar terbentuk.
      // Penghitung IP dibiarkan agar satu keberhasilan tidak mereset perlindungan
      // terhadap password spraying dari alamat yang sama.
      await hapusPenghitung(pool, kunci);
      pasangCookieSesi(res, sesi.token);

      kirimData(res, 200, await bentukKonteks(pool, akun.id, akun.nama, akun.peran));
    }),
  );

  ruta.post(
    "/api/auth/keluar",
    wajibMasuk(pool),
    bungkus(async (req, res) => {
      await cabutSesi(pool, req.penuntut!.token);
      res.clearCookie(NAMA_COOKIE_SESI, pilihanCookie());
      res.status(204).end();
    }),
  );

  return ruta;
}

/**
 * Cookie sesi — API.md §2.5.
 *
 * `Secure` tetap dipasang pada pengembangan lokal: peramban memperlakukan
 * `http://localhost` sebagai asal tepercaya, sehingga cookie `Secure` tetap
 * tersimpan di sana. Tidak diperlukan sakelar yang mematikannya, dan sakelar
 * semacam itu justru berisiko tertinggal menyala di produksi.
 */
function pilihanCookie() {
  return { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/" };
}

function pasangCookieSesi(res: Parameters<typeof kirimData>[0], token: string): void {
  res.cookie(NAMA_COOKIE_SESI, token, {
    ...pilihanCookie(),
    maxAge: UMUR_SESI_MS,
  });
}
