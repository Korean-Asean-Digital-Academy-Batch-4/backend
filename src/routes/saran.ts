import { Router } from "express";

import type { DependensiApp } from "../dependensi-app.js";
import { bacaKonteksSiswa } from "../db/ai/konteks.js";
import { catatPemakaian, periksaBatas } from "../db/pembatas-laju.js";
import { BATAS_SUGGESTION, JENDELA_SUGGESTION_MS } from "../domain/pembatas-laju.js";
import { KODE, kirimData, kirimKesalahan } from "./amplop.js";
import { bungkus } from "./bungkus.js";
import { wajibMasuk } from "./middleware-sesi.js";

/**
 * Tombol Suggestion — [API.md §9.1] dan [ARCHITECTURE.md Pasal 10].
 *
 * Satu endpoint sinkron yang **hanya membaca**. Keluarannya tidak disimpan di
 * mana pun: tidak ada tabel, tidak ada cache, tidak ada `GET` pasangannya, dan
 * tidak ada riwayat (I-24, NG14, AC-16). Menekan tombol kembali menghasilkan
 * keluaran baru.
 */

/** Teks tetap ketika siswa belum memiliki satu pun nilai — CK-API-19. */
const PESAN_TANPA_DATA =
  "Belum ada nilai yang tercatat pada semester ini, sehingga rekomendasi belum dapat disusun.";

export function rutaSaran(deps: DependensiApp): Router {
  const ruta = Router();
  const harusMasuk = wajibMasuk(deps.pool);

  ruta.post(
    "/api/saya/suggestion",
    harusMasuk,
    bungkus(async (req, res) => {
      const penuntut = req.penuntut!;

      // Lapis peran: hanya Siswa. Administrator, Guru, dan Wali Kelas ditolak
      // — [aktor-role.md §6] dan [API.md §9.1].
      if (penuntut.peran !== "siswa") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Tombol ini hanya tersedia bagi Siswa.");
        return;
      }

      const sekarang = deps.sekarang();
      const kunci = `suggestion:${penuntut.penggunaRef}`;

      // Penghitungnya di `pembatas_laju`, tabel yang TIDAK dapat dibaca app_ro.
      // Karena itu pemeriksaannya memakai pool tulis, bukan pool jalur AI.
      const batas = await periksaBatas(
        deps.pool,
        kunci,
        sekarang,
        BATAS_SUGGESTION,
        JENDELA_SUGGESTION_MS,
      );
      if (!batas.boleh) {
        kirimKesalahan(
          res,
          429,
          KODE.batasLajuTerlampaui,
          "Terlalu banyak permintaan rekomendasi. Silakan coba lagi nanti.",
          [{ coba_lagi_pada: batas.cobaLagiPada.toISOString() }],
        );
        return;
      }

      const konteks = await bacaKonteksSiswa(deps.poolRo, penuntut.penggunaRef);

      // Data kosong dijawab tanpa memanggil AI — CK-API-19. Jatah pembatas laju
      // sengaja TIDAK digerus: tidak ada kredit yang terpakai, dan menghukum
      // siswa yang datanya memang belum ada tidak masuk akal.
      if (!konteks.ada) {
        kirimData(res, 200, {
          teks: PESAN_TANPA_DATA,
          periode_nama: konteks.periodeNama,
          data_sementara: true,
          cukup_data: false,
          dibuat_pada: sekarang.toISOString(),
        });
        return;
      }

      await catatPemakaian(deps.pool, kunci, sekarang, JENDELA_SUGGESTION_MS);

      const hasil = await deps.penasihatAi.sarankan(konteks.konteks);

      // Kegagalan lunak: nilai, presensi, finalisasi, dan distribusi tetap
      // berjalan (AC-21, [PRD §8.6] butir 7). Sebab teknisnya tidak pernah
      // sampai ke siswa — pesannya satu, apa pun yang terjadi di baliknya.
      if (!hasil.berhasil) {
        console.error("suggestion failed", { sebab: hasil.sebab });
        kirimKesalahan(
          res,
          503,
          KODE.layananAiGagal,
          "Rekomendasi tidak dapat dibuat saat ini. Silakan coba beberapa saat lagi.",
        );
        return;
      }

      kirimData(res, 200, {
        teks: hasil.teks,
        periode_nama: konteks.konteks.periodeNama,
        data_sementara: true,
        cukup_data: true,
        dibuat_pada: sekarang.toISOString(),
      });
    }),
  );

  return ruta;
}
