import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../../dependensi-app.js";
import {
  aktifkanPeriode,
  buatPeriode,
  buatTahunAjaran,
  daftarTahunAjaran,
} from "../../db/administrasi/periode.js";
import { KODE, kirimData, kirimKesalahan } from "../amplop.js";
import { bungkus } from "../bungkus.js";
import { wajibAdministrator } from "../middleware-kewenangan.js";
import { wajibMasuk } from "../middleware-sesi.js";

const tanggalIsoSkema = z
  .string()
  .date()
  .refine((nilai) => !nilai.startsWith("0000-"));
const badanTahunSkema = z
  .object({
    nama: z.string().trim().min(1),
    tgl_mulai: tanggalIsoSkema,
    tgl_selesai: tanggalIsoSkema,
  })
  .strict()
  .refine((nilai) => nilai.tgl_selesai > nilai.tgl_mulai);
const badanPeriodeSkema = z
  .object({
    semester: z.enum(["ganjil", "genap"]),
    tgl_mulai: tanggalIsoSkema,
    tgl_selesai: tanggalIsoSkema,
  })
  .strict()
  .refine((nilai) => nilai.tgl_selesai > nilai.tgl_mulai);
const paramsTahunSkema = z.object({ id: z.string().uuid() }).strict();
const paramsPeriodeSkema = z.object({ id: z.string().uuid() }).strict();
const badanKosongSkema = z.object({}).strict();
const queryKosongSkema = z.object({}).strict();

export function rutaPeriode(deps: Pick<DependensiApp, "pool" | "db">): Router {
  const ruta = Router();
  const harusAdmin = [wajibMasuk(deps.pool), wajibAdministrator()] as const;

  ruta.post(
    "/api/tahun-ajaran",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const badan = badanTahunSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Nama serta rentang tanggal tahun ajaran wajib diisi dengan benar.",
        );
        return;
      }
      const hasil = await buatTahunAjaran(deps.db, {
        nama: badan.data.nama,
        tglMulai: badan.data.tgl_mulai,
        tglSelesai: badan.data.tgl_selesai,
      });
      if (!hasil.berhasil) {
        kirimKesalahan(res, 409, KODE.dataSudahAda, hasil.pesan);
        return;
      }
      kirimData(res, 201, tahunKeJson(hasil.data));
    }),
  );

  ruta.get(
    "/api/tahun-ajaran",
    ...harusAdmin,
    bungkus(async (req, res) => {
      if (!queryKosongSkema.safeParse(req.query).success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Daftar tahun ajaran tidak menerima parameter query.",
        );
        return;
      }
      const hasil = await daftarTahunAjaran(deps.db);
      kirimData(
        res,
        200,
        hasil.map((tahun) => ({
          ...tahunKeJson(tahun),
          periode: tahun.periode.map((item) => ({
            id: item.id,
            semester: item.semester,
            tgl_mulai: item.tglMulai,
            tgl_selesai: item.tglSelesai,
            aktif: item.aktif,
          })),
        })),
      );
    }),
  );

  ruta.post(
    "/api/tahun-ajaran/:id/periode",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const params = paramsTahunSkema.safeParse(req.params);
      const badan = badanPeriodeSkema.safeParse(req.body);
      if (!params.success || !badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Pengenal tahun, semester, dan rentang tanggal periode wajib sah.",
        );
        return;
      }
      const hasil = await buatPeriode(deps.db, params.data.id, {
        semester: badan.data.semester,
        tglMulai: badan.data.tgl_mulai,
        tglSelesai: badan.data.tgl_selesai,
      });
      if (!hasil.berhasil) {
        kirimKesalahan(
          res,
          hasil.jenis === "tidak_ditemukan" ? 404 : 409,
          hasil.jenis === "tidak_ditemukan" ? KODE.tidakDitemukan : KODE.dataSudahAda,
          hasil.pesan,
        );
        return;
      }
      kirimData(res, 201, {
        id: hasil.data.id,
        tahun_ajaran_ref: hasil.data.tahunAjaranRef,
        semester: hasil.data.semester,
        tgl_mulai: hasil.data.tglMulai,
        tgl_selesai: hasil.data.tglSelesai,
        aktif: hasil.data.aktif,
      });
    }),
  );

  ruta.patch(
    "/api/periode/:id/aktif",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const params = paramsPeriodeSkema.safeParse(req.params);
      const badan = badanKosongSkema.safeParse(req.body === undefined ? {} : req.body);
      if (!params.success || !badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Pengenal periode atau badan permintaan tidak sah.",
        );
        return;
      }
      const hasil = await aktifkanPeriode(deps.db, params.data.id);
      if (!hasil.berhasil) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        return;
      }
      res.status(204).send();
    }),
  );

  return ruta;
}

type TahunAjaranJson = Readonly<{
  id: string;
  nama: string;
  tgl_mulai: string;
  tgl_selesai: string;
  aktif: boolean;
}>;

function tahunKeJson(
  tahun: Readonly<{
    id: string;
    nama: string;
    tglMulai: string;
    tglSelesai: string;
    aktif: boolean;
  }>,
): TahunAjaranJson {
  return {
    id: tahun.id,
    nama: tahun.nama,
    tgl_mulai: tahun.tglMulai,
    tgl_selesai: tahun.tglSelesai,
    aktif: tahun.aktif,
  };
}
