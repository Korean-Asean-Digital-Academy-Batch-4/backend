import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../../dependensi-app.js";
import {
  buatMapel,
  daftarMapel,
  ubahMapel,
  type MapelDenganGuru,
} from "../../db/administrasi/mapel.js";
import { KODE, kirimData, kirimKesalahan } from "../amplop.js";
import { bungkus } from "../bungkus.js";
import { wajibAdministrator } from "../middleware-kewenangan.js";
import { wajibMasuk } from "../middleware-sesi.js";

const kkmSkema = z.number().int().min(0).max(100);
const badanBuatSkema = z
  .object({
    kode: z.string().trim().min(1),
    nama: z.string().trim().min(1).max(64),
    tingkat: z.enum(["X", "XI", "XII"]),
    kkm: kkmSkema.optional(),
    guru_ref: z.string().uuid(),
  })
  .strict();
const badanUbahSkema = z
  .object({
    nama: z.string().trim().min(1).max(64).optional(),
    kkm: kkmSkema.optional(),
  })
  .strict()
  .refine((nilai) => nilai.nama !== undefined || nilai.kkm !== undefined);
const paramsSkema = z.object({ id: z.string().uuid() }).strict();
const queryKosongSkema = z.object({}).strict();

export function rutaMapel(deps: Pick<DependensiApp, "pool" | "db">): Router {
  const ruta = Router();
  const harusAdmin = [wajibMasuk(deps.pool), wajibAdministrator()] as const;

  ruta.post(
    "/api/mapel",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const badan = badanBuatSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Kode, nama, tingkat, KKM, dan Guru mata pelajaran wajib sah.",
        );
        return;
      }
      const hasil = await buatMapel(deps.db, {
        kode: badan.data.kode,
        nama: badan.data.nama,
        tingkat: badan.data.tingkat,
        ...(badan.data.kkm === undefined ? {} : { kkm: badan.data.kkm }),
        guruRef: badan.data.guru_ref,
      });
      if (!hasil.berhasil) {
        if (hasil.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        } else if (hasil.jenis === "guru_sudah_mengampu") {
          kirimKesalahan(res, 409, KODE.guruSudahMengampu, hasil.pesan);
        } else {
          kirimKesalahan(res, 409, KODE.dataSudahAda, hasil.pesan);
        }
        return;
      }
      kirimData(res, 201, mapelKeJson(hasil.data));
    }),
  );

  ruta.get(
    "/api/mapel",
    ...harusAdmin,
    bungkus(async (req, res) => {
      if (!queryKosongSkema.safeParse(req.query).success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Daftar mata pelajaran tidak menerima parameter query.",
        );
        return;
      }
      const hasil = await daftarMapel(deps.db);
      kirimData(res, 200, hasil.map(mapelKeJson));
    }),
  );

  ruta.patch(
    "/api/mapel/:id",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const params = paramsSkema.safeParse(req.params);
      const badan = badanUbahSkema.safeParse(req.body);
      if (!params.success || !badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Pengenal, nama, atau KKM mata pelajaran tidak sah.",
        );
        return;
      }
      const hasil = await ubahMapel(deps.db, params.data.id, {
        ...(badan.data.nama === undefined ? {} : { nama: badan.data.nama }),
        ...(badan.data.kkm === undefined ? {} : { kkm: badan.data.kkm }),
      });
      if (!hasil.berhasil) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        return;
      }
      kirimData(res, 200, mapelKeJson(hasil.data));
    }),
  );

  return ruta;
}

function mapelKeJson(item: MapelDenganGuru): Record<string, unknown> {
  return {
    id: item.id,
    kode: item.kode,
    nama: item.nama,
    tingkat: item.tingkat,
    kkm: item.kkm,
    guru: {
      id: item.guru.id,
      nama: item.guru.nama,
      nama_pengguna: item.guru.namaPengguna,
    },
  };
}
