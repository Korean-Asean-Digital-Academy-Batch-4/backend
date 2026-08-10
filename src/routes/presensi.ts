import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { DependensiApp } from "../dependensi-app.js";
import {
  bacaSesi,
  buatSesi,
  cariKonteksPenugasanPresensi,
  daftarSesiPenugasan,
  daftarSiswaKelasPresensi,
  hapusSesi,
  namaPeriodeKelasPresensi,
  presensiSatuKelas,
  presensiSiswaPerKelas,
  ubahPresensiSesi,
} from "../db/pencatatan/presensi.js";
import { kelas, kelasSiswa } from "../db/skema/periode.js";
import { STATUS_PRESENSI } from "../domain/presensi.js";
import { KODE, kirimData, kirimKesalahan } from "./amplop.js";
import { bungkus } from "./bungkus.js";
import { wajibMasuk } from "./middleware-sesi.js";

/**
 * Rute presensi — API.md §7 dan §9.
 *
 * Membuka layar tidak menulis apa pun (CK-API-11): GET hanya membaca. Siswa
 * tidak memperoleh rincian per tanggal (AC-30); Wali Kelas hanya ringkasan
 * kelas walinya (PRD §8.4).
 */

const uuidSkema = z.string().uuid();

const presensiBarisSkema = z
  .object({
    siswa_ref: uuidSkema,
    status: z.enum(STATUS_PRESENSI),
    catatan: z.string().max(200).nullable().default(null),
  })
  .strict();

// Regex lolos terhadap tanggal non-kalender (2026-02-30) yang ditolak
// PostgreSQL 22008; validasi kalender di sini menjadikannya 400 yang
// deterministik alih-alih 500 yang bergantung pada pesan basis data.
const tanggalSesi = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal wajib berbentuk YYYY-MM-DD.")
  .refine(
    (t) => {
      const [tahun, bulan, hari] = t.split("-").map(Number);
      const d = new Date(Date.UTC(tahun!, bulan! - 1, hari));
      return (
        d.getUTCFullYear() === tahun &&
        d.getUTCMonth() === bulan! - 1 &&
        d.getUTCDate() === hari
      );
    },
    { message: "Tanggal wajib tanggal kalender yang sah." },
  );

const buatSesiSkema = z
  .object({
    tanggal: tanggalSesi,
    presensi: z.array(presensiBarisSkema).max(2000).default([]),
  })
  .strict();

const ubahSesiSkema = z.object({ presensi: z.array(presensiBarisSkema).max(2000) }).strict();

export function rutaPresensi(deps: Pick<DependensiApp, "pool" | "db">): Router {
  const ruta = Router();
  const harusMasuk = wajibMasuk(deps.pool);

  const periksaAksesPenugasan = async (
    penugasanRef: string,
    penuntut: Readonly<{ penggunaRef: string; peran: string }>,
  ): Promise<
    { ok: true; kelasRef: string } | { ok: false; status: number; kode: string; pesan: string }
  > => {
    const konteks = await cariKonteksPenugasanPresensi(deps.db, penugasanRef);
    if (!konteks) {
      return {
        ok: false,
        status: 404,
        kode: KODE.tidakDitemukan,
        pesan: "Penugasan tidak ditemukan.",
      };
    }
    if (penuntut.peran === "guru" && konteks.guruRef !== penuntut.penggunaRef) {
      return {
        ok: false,
        status: 403,
        kode: KODE.kewenanganDitolak,
        pesan: "Anda tidak berwenang atas penugasan ini.",
      };
    }
    return { ok: true, kelasRef: konteks.kelasRef };
  };

  ruta.get(
    "/api/penugasan/:id/siswa",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal penugasan tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "guru" && penuntut.peran !== "administrator") {
        kirimKesalahan(
          res,
          403,
          KODE.kewenanganDitolak,
          "Anda tidak berwenang melihat daftar siswa.",
        );
        return;
      }
      const akses = await periksaAksesPenugasan(id.data, penuntut);
      if (!akses.ok) {
        kirimKesalahan(res, akses.status, akses.kode, akses.pesan);
        return;
      }
      const siswa = await daftarSiswaKelasPresensi(deps.db, akses.kelasRef);
      kirimData(res, 200, { siswa });
    }),
  );

  ruta.get(
    "/api/penugasan/:id/sesi",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal penugasan tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "guru" && penuntut.peran !== "administrator") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda tidak berwenang melihat sesi.");
        return;
      }
      const akses = await periksaAksesPenugasan(id.data, penuntut);
      if (!akses.ok) {
        kirimKesalahan(res, akses.status, akses.kode, akses.pesan);
        return;
      }
      const sesi = await daftarSesiPenugasan(deps.db, id.data);
      kirimData(res, 200, { sesi });
    }),
  );

  ruta.post(
    "/api/penugasan/:id/sesi",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal penugasan tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "guru" && penuntut.peran !== "administrator") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda tidak berwenang membuka sesi.");
        return;
      }
      const badan = buatSesiSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Badan permintaan tidak sah. Tanggal wajib YYYY-MM-DD.",
        );
        return;
      }
      const hasil = await buatSesi(
        {
          penugasanRef: id.data,
          penuntut: { penggunaRef: penuntut.penggunaRef, peran: penuntut.peran },
          tanggal: badan.data.tanggal,
          presensi: badan.data.presensi.map((p) => ({
            siswaRef: p.siswa_ref,
            status: p.status,
            catatan: p.catatan,
          })),
        },
        deps.db,
      );
      if (!hasil.berhasil) {
        if (hasil.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        } else if (hasil.jenis === "kewenangan_ditolak") {
          kirimKesalahan(res, 403, KODE.kewenanganDitolak, hasil.pesan);
        } else if (hasil.jenis === "sesi_sudah_ada") {
          kirimKesalahan(res, 409, KODE.sesiSudahAda, hasil.pesan);
        } else if (hasil.jenis === "rapor_terkunci") {
          kirimKesalahan(res, 409, KODE.raporTerkunci, hasil.pesan);
        } else {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        }
        return;
      }
      kirimData(res, 201, hasil.data);
    }),
  );

  ruta.get(
    "/api/sesi/:id",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal sesi tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "guru" && penuntut.peran !== "administrator") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda tidak berwenang melihat sesi.");
        return;
      }
      const sesi = await bacaSesi(deps.db, id.data);
      if (!sesi) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, "Sesi tidak ditemukan.");
        return;
      }
      const akses = await periksaAksesPenugasan(sesi.penugasan_ref, penuntut);
      if (!akses.ok) {
        kirimKesalahan(res, akses.status, akses.kode, akses.pesan);
        return;
      }
      kirimData(res, 200, sesi);
    }),
  );

  ruta.put(
    "/api/sesi/:id/presensi",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal sesi tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "guru" && penuntut.peran !== "administrator") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda tidak berwenang mengubah presensi.");
        return;
      }
      const badan = ubahSesiSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Badan permintaan tidak sah.");
        return;
      }
      const hasil = await ubahPresensiSesi(
        {
          sesiRef: id.data,
          penuntut: { penggunaRef: penuntut.penggunaRef, peran: penuntut.peran },
          presensi: badan.data.presensi.map((p) => ({
            siswaRef: p.siswa_ref,
            status: p.status,
            catatan: p.catatan,
          })),
        },
        deps.db,
      );
      if (!hasil.berhasil) {
        if (hasil.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        } else if (hasil.jenis === "kewenangan_ditolak") {
          kirimKesalahan(res, 403, KODE.kewenanganDitolak, hasil.pesan);
        } else if (hasil.jenis === "rapor_terkunci") {
          kirimKesalahan(res, 409, KODE.raporTerkunci, hasil.pesan);
        } else {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        }
        return;
      }
      kirimData(res, 200, hasil.data);
    }),
  );

  ruta.delete(
    "/api/sesi/:id",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal sesi tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "guru" && penuntut.peran !== "administrator") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda tidak berwenang menghapus sesi.");
        return;
      }
      const hasil = await hapusSesi(
        id.data,
        { penggunaRef: penuntut.penggunaRef, peran: penuntut.peran },
        deps.db,
      );
      if (!hasil.berhasil) {
        if (hasil.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        } else if (hasil.jenis === "kewenangan_ditolak") {
          kirimKesalahan(res, 403, KODE.kewenanganDitolak, hasil.pesan);
        } else if (hasil.jenis === "rapor_terkunci") {
          kirimKesalahan(res, 409, KODE.raporTerkunci, hasil.pesan);
        } else {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        }
        return;
      }
      res.status(204).end();
    }),
  );

  ruta.get(
    "/api/kelas/:id/presensi",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal kelas tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "guru" && penuntut.peran !== "administrator") {
        kirimKesalahan(
          res,
          403,
          KODE.kewenanganDitolak,
          "Anda tidak berwenang melihat presensi kelas.",
        );
        return;
      }
      if (penuntut.peran === "guru") {
        const [wali] = await deps.db
          .select({ id: kelas.id })
          .from(kelas)
          .where(sql`${kelas.id} = ${id.data} AND ${kelas.waliKelasRef} = ${penuntut.penggunaRef}`)
          .limit(1);
        if (!wali) {
          kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda bukan Wali Kelas kelas ini.");
          return;
        }
      }
      const [ada] = await deps.db
        .select({ id: kelas.id })
        .from(kelas)
        .where(eq(kelas.id, id.data))
        .limit(1);
      if (!ada) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, "Kelas tidak ditemukan.");
        return;
      }
      const siswa = await presensiSatuKelas(deps.db, id.data);
      kirimData(res, 200, { siswa });
    }),
  );

  ruta.get(
    "/api/saya/presensi",
    harusMasuk,
    bungkus(async (req, res) => {
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "siswa") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Endpoint ini hanya bagi Siswa.");
        return;
      }
      const [keanggotaan] = await deps.db
        .select({ kelasRef: kelasSiswa.kelasRef })
        .from(kelasSiswa)
        .innerJoin(kelas, eq(kelas.id, kelasSiswa.kelasRef))
        .where(eq(kelasSiswa.siswaRef, penuntut.penggunaRef))
        .limit(1);
      if (!keanggotaan) {
        kirimData(res, 200, { periode_nama: null, mapel: [] });
        return;
      }
      const periodeNama = await namaPeriodeKelasPresensi(deps.db, keanggotaan.kelasRef);
      const mapel = await presensiSiswaPerKelas(
        deps.db,
        keanggotaan.kelasRef,
        penuntut.penggunaRef,
      );
      kirimData(res, 200, { periode_nama: periodeNama ?? null, mapel });
    }),
  );

  return ruta;
}
