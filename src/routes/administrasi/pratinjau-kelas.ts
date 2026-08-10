import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../../dependensi-app.js";
import { pratinjauKelas, type PratinjauKelas } from "../../db/administrasi/pratinjau-kelas.js";
import { pakaiJatahUnggah } from "../../db/administrasi/pembatas-unggah.js";
import { KODE, kirimData, kirimKesalahan } from "../amplop.js";
import { bungkus } from "../bungkus.js";
import { wajibAdministrator } from "../middleware-kewenangan.js";
import { wajibMasuk } from "../middleware-sesi.js";
import { bacaBerkasMultipart } from "../multipart.js";

const bidangSkema = z.object({ periode_ref: z.string().uuid() }).strict();

export function rutaPratinjauKelas(
  deps: Pick<DependensiApp, "pool" | "db" | "berkasAdministrasi" | "sekarang">,
): Router {
  const ruta = Router();

  ruta.post(
    "/api/kelas/pratinjau",
    wajibMasuk(deps.pool),
    wajibAdministrator(),
    bungkus(async (req, res) => {
      const jatah = await pakaiJatahUnggah(deps.db, req.penuntut!.penggunaRef, deps.sekarang());
      if (!jatah.boleh) {
        kirimKesalahan(
          res,
          429,
          KODE.batasLajuTerlampaui,
          "Terlalu banyak percobaan unggah. Silakan coba lagi beberapa saat lagi.",
          [{ coba_lagi_pada: jatah.cobaLagiPada.toISOString() }],
        );
        return;
      }

      const multipart = await bacaBerkasMultipart(req);
      if (!multipart.berhasil) {
        kirimKesalahan(
          res,
          multipart.status,
          multipart.kode === "BERKAS_TERLALU_BESAR"
            ? KODE.berkasTerlaluBesar
            : KODE.permintaanTidakSah,
          multipart.pesan,
        );
        return;
      }

      const bidang = bidangSkema.safeParse(multipart.bidang);
      if (!bidang.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Bidang periode_ref wajib berupa UUID periode sasaran dan tidak boleh memuat bidang lain.",
        );
        return;
      }

      const terurai = await deps.berkasAdministrasi.uraiDaftarSiswaXlsx(multipart.berkas);
      const hasil = await pratinjauKelas(deps.db, bidang.data.periode_ref, terurai);
      if (!hasil.berhasil) {
        if (hasil.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        } else if (hasil.jenis === "berkas_tidak_sah") {
          kirimKesalahan(res, 400, KODE.berkasTidakSah, hasil.pesan, hasil.rincian);
        } else {
          throw new Error("Hasil pratinjau kelas tidak didukung oleh rute.");
        }
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      kirimData(res, 200, pratinjauKeJson(hasil.data));
    }),
  );

  return ruta;
}

function pratinjauKeJson(input: PratinjauKelas): Record<string, unknown> {
  return {
    kelas_berkas: input.kelasBerkas,
    cocok: input.cocok.map((item) => ({
      baris: item.baris,
      nis: item.nis,
      nama_berkas: item.namaBerkas,
      nama_sistem: item.namaSistem,
      siswa_ref: item.siswaRef,
    })),
    bermasalah: input.bermasalah.map((item) => ({ ...item })),
  };
}
