import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../../dependensi-app.js";
import { daftarKomponen, gantiKomponen } from "../../db/administrasi/komponen.js";
import { KODE, kirimData, kirimKesalahan } from "../amplop.js";
import { bungkus } from "../bungkus.js";
import { wajibAdministrator } from "../middleware-kewenangan.js";
import { wajibMasuk } from "../middleware-sesi.js";

const komponenSkema = z
  .object({
    kode: z.string().trim().min(1),
    nama: z.string().trim().min(1),
    bobot: z.number().int().min(1).max(100),
    urutan: z.number().int().min(-32_768).max(32_767),
  })
  .strict();
const badanSkema = z
  .object({ komponen: z.array(komponenSkema) })
  .strict()
  .superRefine((nilai, ctx) => {
    if (new Set(nilai.komponen.map((item) => item.kode)).size !== nilai.komponen.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Kode komponen berulang." });
    }
    if (new Set(nilai.komponen.map((item) => item.urutan)).size !== nilai.komponen.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Urutan komponen berulang." });
    }
  });
const queryKosongSkema = z.object({}).strict();

export function rutaKomponen(deps: Pick<DependensiApp, "pool" | "db">): Router {
  const ruta = Router();
  const harusMasuk = wajibMasuk(deps.pool);

  ruta.get(
    "/api/komponen-penilaian",
    harusMasuk,
    bungkus(async (req, res) => {
      if (!queryKosongSkema.safeParse(req.query).success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Daftar komponen penilaian tidak menerima parameter query.",
        );
        return;
      }
      kirimData(res, 200, await daftarKomponen(deps.db));
    }),
  );

  ruta.put(
    "/api/komponen-penilaian",
    harusMasuk,
    wajibAdministrator(),
    bungkus(async (req, res) => {
      const badan = badanSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Daftar komponen penilaian wajib memiliki kode dan urutan yang unik.",
        );
        return;
      }
      const hasil = await gantiKomponen(deps.db, badan.data.komponen);
      if (!hasil.berhasil) {
        if (hasil.jenis === "bobot_tidak_seratus") {
          kirimKesalahan(res, 400, KODE.bobotTidakSeratus, hasil.pesan);
        } else if (hasil.jenis === "komponen_sudah_dipakai") {
          kirimKesalahan(res, 409, KODE.komponenSudahDipakai, hasil.pesan);
        } else {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        }
        return;
      }
      kirimData(res, 200, hasil.data);
    }),
  );

  return ruta;
}
