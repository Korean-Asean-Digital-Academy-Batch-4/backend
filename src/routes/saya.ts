import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";

import { BATAS_MASUK, JENDELA_MASUK_MS } from "../domain/pembatas-laju.js";
import { cariPenggunaUntukMasuk, muatKonteksPengguna } from "../db/akun.js";
import { catatKegagalan, hapusPenghitung, periksaBatas } from "../db/pembatas-laju.js";
import { cabutSeluruhSesi } from "../db/sesi.js";
import type { KataSandi } from "../ports/kata-sandi.js";
import { KODE, PESAN_KREDENSIAL_SALAH, kirimData, kirimKesalahan } from "./amplop.js";
import { bungkus } from "./bungkus.js";
import { wajibMasuk } from "./middleware-sesi.js";

/** Akun sendiri — API.md §3.2. */

const gantiSkema = z
  .object({
    kata_sandi_lama: z.string().min(1).max(128),
    kata_sandi_baru: z.string().min(1).max(128),
  })
  .strict();

/**
 * Bentuk respons yang dipakai bersama oleh `POST /api/auth/masuk` dan
 * `GET /api/saya` — API.md §3.2 menyatakan keduanya berbentuk sama.
 */
export async function bentukKonteks(
  pool: Pool,
  penggunaRef: string,
  nama: string,
  peran: string,
): Promise<Record<string, unknown>> {
  const konteks = await muatKonteksPengguna(pool, penggunaRef);

  return {
    id: penggunaRef,
    nama,
    peran,
    penugasan: konteks.penugasan.map((p) => ({
      id: p.id,
      kelas_nama: p.kelasNama,
      mapel_nama: p.mapelNama,
    })),
    wali_kelas: konteks.waliKelas.map((w) => ({
      kelas_ref: w.kelasRef,
      kelas_nama: w.kelasNama,
    })),
  };
}

export function rutaSaya(pool: Pool, kataSandi: KataSandi): Router {
  const ruta = Router();

  ruta.get(
    "/api/saya",
    wajibMasuk(pool),
    bungkus(async (req, res) => {
      const penuntut = req.penuntut!;
      const hasil = await pool.query<{ nama: string; peran: string }>(
        `SELECT nama, peran FROM pengguna WHERE id = $1`,
        [penuntut.penggunaRef],
      );
      const baris = hasil.rows[0];
      if (!baris) {
        kirimKesalahan(res, 401, KODE.sesiTidakSah, "Akun tidak lagi tersedia.");
        return;
      }

      kirimData(res, 200, await bentukKonteks(pool, penuntut.penggunaRef, baris.nama, baris.peran));
    }),
  );

  // Mencabut seluruh sesi LAIN milik pengguna dan mempertahankan yang sedang
  // dipakai (CK-API-06): penggantian kata sandi mengeluarkan penyusup tanpa
  // mengeluarkan pemiliknya sendiri.
  ruta.patch(
    "/api/saya/kata-sandi",
    wajibMasuk(pool),
    bungkus(async (req, res) => {
      const badan = gantiSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Kata sandi lama dan kata sandi baru wajib diisi.",
        );
        return;
      }

      const penuntut = req.penuntut!;
      const sekarang = new Date();

      // Pasal 7 hanya mendaftar tiga jalur terbatas, dan ini bukan salah
      // satunya — tetapi jalur ini juga memverifikasi kata sandi, dan PRD
      // sec 6.1.3 meniadakan syarat kerumitan. Membiarkannya tanpa batas berarti
      // sesi yang bocor dapat dipakai menebak kata sandi tanpa hambatan, lalu
      // menggantinya. Pengerasan tambahan, bukan pelonggaran kontrak.
      const kunci = `ganti-sandi:pengguna:${penuntut.penggunaRef}`;
      const batas = await periksaBatas(pool, kunci, sekarang, BATAS_MASUK, JENDELA_MASUK_MS);
      if (!batas.boleh) {
        kirimKesalahan(
          res,
          429,
          KODE.batasLajuTerlampaui,
          "Terlalu banyak percobaan. Silakan coba lagi beberapa saat lagi.",
          [{ coba_lagi_pada: batas.cobaLagiPada.toISOString() }],
        );
        return;
      }

      const hasil = await pool.query<{ nama_pengguna: string }>(
        `SELECT nama_pengguna FROM pengguna WHERE id = $1`,
        [penuntut.penggunaRef],
      );
      const namaPengguna = hasil.rows[0]?.nama_pengguna;
      const akun = namaPengguna ? await cariPenggunaUntukMasuk(pool, namaPengguna) : null;

      if (!akun || !(await kataSandi.verifikasi(akun.kataSandiHash, badan.data.kata_sandi_lama))) {
        await catatKegagalan(pool, kunci, sekarang, JENDELA_MASUK_MS);
        kirimKesalahan(res, 401, KODE.kredensialSalah, PESAN_KREDENSIAL_SALAH);
        return;
      }
      await hapusPenghitung(pool, kunci);

      const hashBaru = await kataSandi.hash(badan.data.kata_sandi_baru);
      await pool.query(`UPDATE pengguna SET kata_sandi_hash = $1 WHERE id = $2`, [
        hashBaru,
        penuntut.penggunaRef,
      ]);
      await cabutSeluruhSesi(pool, penuntut.penggunaRef, penuntut.token);

      res.status(204).end();
    }),
  );

  return ruta;
}
