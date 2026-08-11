import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../dependensi-app.js";
import { bolehUnduhRapor, cariRapor } from "../db/rapor/akses.js";
import { pastikanBerkasRapor, type DependensiBerkas } from "../db/rapor/berkas.js";
import { BATAS_CATATAN_WALI, simpanCatatanWali } from "../db/rapor/catatan.js";
import { UMUR_TAUTAN_DETIK } from "../ports/penyimpanan-berkas.js";
import { KODE, kirimData, kirimKesalahan } from "./amplop.js";
import { bungkus } from "./bungkus.js";
import { wajibMasuk } from "./middleware-sesi.js";

/**
 * Rute rapor per siswa — [API.md §8.2] dan §8.4.
 *
 * Lapis baris berada di `db/rapor/akses.ts`: Administrator tanpa batas, Wali
 * Kelas hanya kelas walinya, Siswa hanya rapor miliknya dan yang sudah
 * didistribusikan (I-25). Guru Mata Pelajaran ditolak tanpa aturan terpisah —
 * AC-32.
 */

const uuidSkema = z.string().uuid();

const catatanSkema = z
  .object({
    catatan_wali: z.string().max(BATAS_CATATAN_WALI).nullable(),
  })
  .strict();

export function rutaRapor(deps: DependensiApp): Router {
  const ruta = Router();
  const harusMasuk = wajibMasuk(deps.pool);
  const depsBerkas: DependensiBerkas = {
    db: deps.db,
    penyimpanan: deps.penyimpanan,
    raporBerkas: deps.raporBerkas,
    sekarang: deps.sekarang,
  };

  ruta.patch(
    "/api/rapor/:id",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal rapor tidak sah.");
        return;
      }
      const badan = catatanSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          `Catatan wali wajib berupa teks paling panjang ${BATAS_CATATAN_WALI} aksara, atau null.`,
        );
        return;
      }
      const penuntut = req.penuntut!;
      const hasil = await simpanCatatanWali(deps.db, {
        raporRef: id.data,
        catatanWali: badan.data.catatan_wali,
        penuntut: { penggunaRef: penuntut.penggunaRef, peran: penuntut.peran },
      });
      if (!hasil.berhasil) {
        if (hasil.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        } else if (hasil.jenis === "kewenangan_ditolak") {
          kirimKesalahan(res, 403, KODE.kewenanganDitolak, hasil.pesan);
        } else {
          kirimKesalahan(res, 409, KODE.raporTerkunci, hasil.pesan);
        }
        return;
      }
      kirimData(res, 200, { id: hasil.data.id, catatan_wali: hasil.data.catatanWali });
    }),
  );

  ruta.get(
    "/api/rapor/:id/berkas",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal rapor tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      const satu = await cariRapor(deps.db, id.data);
      if (!satu) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, "Rapor tidak ditemukan.");
        return;
      }
      if (!bolehUnduhRapor(satu, penuntut)) {
        kirimKesalahan(
          res,
          403,
          KODE.kewenanganDitolak,
          "Anda tidak berwenang mengunduh rapor ini.",
        );
        return;
      }

      // Berkas biasanya sudah ada sejak finalisasi. Yang belum ada dirender saat
      // itu juga dari salinan beku, lalu disimpan — [API.md §8.4].
      const berkas = await pastikanBerkasRapor(depsBerkas, satu.id, satu.periodeRef);
      if (!berkas.ada) {
        // Hanya dapat dicapai Administrator dan Wali Kelas: lapis baris sudah
        // menutup Siswa atas rapor yang belum `distributed`.
        kirimKesalahan(
          res,
          409,
          KODE.berkasBelumSiap,
          "Rapor ini belum difinalisasi, sehingga berkasnya belum dapat diunduh.",
        );
        return;
      }

      const tautan = await deps.penyimpanan.tautan(berkas.kunci, UMUR_TAUTAN_DETIK);
      kirimData(res, 200, {
        url: tautan.url,
        kedaluwarsa_pada: tautan.kedaluwarsaPada.toISOString(),
      });
    }),
  );

  return ruta;
}
