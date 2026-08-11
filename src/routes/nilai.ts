import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../dependensi-app.js";
import {
  bacaMatriksNilai,
  namaPeriodeKelas,
  nilaiSatuKelas,
  nilaiSiswaPerKelas,
  simpanNilai,
  cariKonteksPenugasan,
} from "../db/pencatatan/nilai.js";
import { kelas, kelasSiswa, periode } from "../db/skema/periode.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { KODE, kirimData, kirimKesalahan } from "./amplop.js";
import { bungkus } from "./bungkus.js";
import { wajibMasuk } from "./middleware-sesi.js";

/**
 * Rute nilai — API.md §6 dan §9.
 *
 * Lapis peran: `administrator`, `guru`, dan `siswa` masing-masing pada
 * endpointnya. Lapis baris: Guru hanya penugasannya; Wali Kelas hanya kelas
 * walinya; Siswa hanya datanya sendiri — I-25 (ARCHITECTURE.md §9.2).
 */

const uuidSkema = z.string().uuid();

const nilaiAngka = z
  .number()
  .min(0)
  .max(100)
  .refine(
    (n) => {
      const dalamSen = n * 100;
      return Number.isFinite(n) && Math.abs(Math.round(dalamSen) - dalamSen) < 1e-9;
    },
    {
      message: "Nilai menerima paling banyak dua desimal.",
    },
  );

const barisNilaiSkema = z
  .object({
    siswa_ref: uuidSkema,
    komponen_ref: uuidSkema,
    nilai: nilaiAngka.nullable(),
  })
  .strict();

const topikSkema = z
  .object({
    komponen_ref: uuidSkema,
    topik: z.string().max(200).nullable(),
  })
  .strict();

const simpanNilaiSkema = z
  .object({
    nilai: z.array(barisNilaiSkema).max(2000),
    topik: z.array(topikSkema).max(64).default([]),
  })
  .strict();

export function rutaNilai(deps: Pick<DependensiApp, "pool" | "db">): Router {
  const ruta = Router();
  const harusMasuk = wajibMasuk(deps.pool);

  ruta.get(
    "/api/penugasan/:id/nilai",
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
          "Anda tidak berwenang melihat nilai penugasan.",
        );
        return;
      }
      const konteks = await cariKonteksPenugasan(deps.db, id.data);
      if (!konteks) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, "Penugasan tidak ditemukan.");
        return;
      }
      if (penuntut.peran === "guru" && konteks.guruRef !== penuntut.penggunaRef) {
        kirimKesalahan(
          res,
          403,
          KODE.kewenanganDitolak,
          "Anda tidak berwenang atas penugasan ini.",
        );
        return;
      }
      const hasil = await bacaMatriksNilai(deps.db, id.data);
      if (!hasil.berhasil) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        return;
      }
      kirimData(res, 200, {
        penugasan: {
          id: hasil.data.penugasan.id,
          kelas_nama: hasil.data.penugasan.kelasNama,
          mapel_nama: hasil.data.penugasan.mapelNama,
          kkm: hasil.data.penugasan.kkm,
        },
        komponen: hasil.data.komponen,
        siswa: hasil.data.siswa.map((item) => ({
          siswa_ref: item.siswaRef,
          nama: item.nama,
        })),
        nilai: hasil.data.nilai.map((item) => ({
          siswa_ref: item.siswaRef,
          komponen_ref: item.komponenRef,
          nilai: item.nilai,
        })),
      });
    }),
  );

  ruta.post(
    "/api/penugasan/:id/nilai",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal penugasan tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "guru" && penuntut.peran !== "administrator") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda tidak berwenang menyimpan nilai.");
        return;
      }
      const badan = simpanNilaiSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Badan permintaan tidak sah. Nilai wajib 0–100 dengan paling banyak dua desimal, atau null.",
        );
        return;
      }
      const hasil = await simpanNilai(
        {
          penugasanRef: id.data,
          penuntut: { penggunaRef: penuntut.penggunaRef, peran: penuntut.peran },
          nilai: badan.data.nilai.map((n) => ({
            siswaRef: n.siswa_ref,
            komponenRef: n.komponen_ref,
            nilai: n.nilai,
          })),
          topik: badan.data.topik.map((t) => ({
            komponenRef: t.komponen_ref,
            topik: t.topik,
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
        } else if (hasil.jenis === "siswa_asing" || hasil.jenis === "komponen_asing") {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        } else {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        }
        return;
      }
      kirimData(res, 200, hasil.data);
    }),
  );

  ruta.get(
    "/api/kelas/:id/nilai",
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
          "Anda tidak berwenang melihat nilai kelas.",
        );
        return;
      }
      // Lapis baris Wali Kelas: kelas.wali_kelas_ref menunjuk pengguna.
      if (penuntut.peran === "guru") {
        const [kelasWali] = await deps.db
          .select({ id: kelas.id })
          .from(kelas)
          .where(sql`${kelas.id} = ${id.data} AND ${kelas.waliKelasRef} = ${penuntut.penggunaRef}`)
          .limit(1);
        if (!kelasWali) {
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
      const data = await nilaiSatuKelas(deps.db, id.data);
      kirimData(res, 200, data);
    }),
  );

  ruta.get(
    "/api/saya/nilai",
    harusMasuk,
    bungkus(async (req, res) => {
      const penuntut = req.penuntut!;
      if (penuntut.peran !== "siswa") {
        kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Endpoint ini hanya bagi Siswa.");
        return;
      }
      // Kelas siswa pada semester berjalan — I-25: hanya datanya sendiri.
      const [keanggotaan] = await deps.db
        .select({ kelasRef: kelasSiswa.kelasRef })
        .from(kelasSiswa)
        .innerJoin(kelas, eq(kelas.id, kelasSiswa.kelasRef))
        .innerJoin(periode, eq(periode.id, kelas.periodeRef))
        .where(and(eq(kelasSiswa.siswaRef, penuntut.penggunaRef), eq(periode.aktif, true)))
        .orderBy(desc(periode.tglMulai), desc(periode.id), desc(kelas.id))
        .limit(1);
      if (!keanggotaan) {
        kirimData(res, 200, { periode_nama: null, mapel: [] });
        return;
      }
      const periodeNama = await namaPeriodeKelas(deps.db, keanggotaan.kelasRef);
      const mapel = await nilaiSiswaPerKelas(deps.db, keanggotaan.kelasRef, penuntut.penggunaRef);
      kirimData(res, 200, { periode_nama: periodeNama ?? null, mapel });
    }),
  );

  return ruta;
}
