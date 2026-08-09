import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../../dependensi-app.js";
import { KODE, kirimKesalahan } from "../amplop.js";
import { bungkus } from "../bungkus.js";
import { wajibAdministrator } from "../middleware-kewenangan.js";
import { wajibMasuk } from "../middleware-sesi.js";

const queryPeran = z.object({ peran: z.enum(["guru", "siswa"]) }).strict();
const JENIS_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function rutaTemplat(deps: Pick<DependensiApp, "pool" | "berkasAdministrasi">): Router {
  const ruta = Router();
  const harusAdmin = [wajibMasuk(deps.pool), wajibAdministrator()] as const;

  ruta.get(
    "/api/templat/pengguna.csv",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const query = queryPeran.safeParse(req.query);
      if (!query.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Parameter peran wajib bernilai guru atau siswa.",
        );
        return;
      }

      const berkas = await deps.berkasAdministrasi.buatTemplatAkunCsv(query.data.peran);
      res.status(200);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="templat-pengguna-${query.data.peran}.csv"`,
      );
      res.send(berkas);
    }),
  );

  ruta.get(
    "/api/templat/daftar-siswa.xlsx",
    ...harusAdmin,
    bungkus(async (_req, res) => {
      const berkas = await deps.berkasAdministrasi.buatTemplatDaftarSiswaXlsx();
      res.status(200);
      res.setHeader("Content-Type", JENIS_XLSX);
      res.setHeader("Content-Disposition", 'attachment; filename="templat-daftar-siswa.xlsx"');
      res.send(berkas);
    }),
  );

  return ruta;
}
