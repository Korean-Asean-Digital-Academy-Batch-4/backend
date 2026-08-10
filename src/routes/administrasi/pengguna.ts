import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../../dependensi-app.js";
import {
  buatBanyakPengguna,
  buatPengguna,
  daftarPengguna,
  rincianKonflikPenggunaUnggah,
  resetKataSandi,
} from "../../db/administrasi/pengguna.js";
import { pakaiJatahUnggah } from "../../db/administrasi/pembatas-unggah.js";
import type { RincianBerkas } from "../../ports/berkas-administrasi.js";
import { KODE, kirimData, kirimKesalahan } from "../amplop.js";
import { bungkus } from "../bungkus.js";
import { wajibAdministrator } from "../middleware-kewenangan.js";
import { wajibMasuk } from "../middleware-sesi.js";
import { bacaBerkasMultipart } from "../multipart.js";
import { hashKataSandiTerbatas } from "./hash-kata-sandi.js";

const peranSkema = z.enum(["guru", "siswa"]);
const badanBuatSkema = z
  .object({
    nama: z.string().trim().min(1).max(128),
    nama_pengguna: z.string().trim().min(1).max(32).regex(/^\d+$/),
    peran: peranSkema,
  })
  .strict();
const queryKosongSkema = z.object({}).strict();
const paramsResetSkema = z.object({ id: z.string().uuid() }).strict();
const badanKosongSkema = z.object({}).strict();
const bidangUnggahSkema = z.object({ peran: peranSkema }).strict();

export function rutaPengguna(
  deps: Pick<DependensiApp, "pool" | "db" | "kataSandi" | "berkasAdministrasi" | "sekarang">,
): Router {
  const ruta = Router();
  const harusAdmin = [wajibMasuk(deps.pool), wajibAdministrator()] as const;

  ruta.post(
    "/api/pengguna",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const badan = badanBuatSkema.safeParse(req.body);
      if (!badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Nama, nama pengguna, dan peran Guru atau Siswa wajib diisi dengan benar.",
        );
        return;
      }

      const kataSandiAwal = deps.kataSandi.buatAwal();
      const kataSandiHash = await deps.kataSandi.hash(kataSandiAwal);
      const hasil = await buatPengguna(deps.db, {
        nama: badan.data.nama,
        namaPengguna: badan.data.nama_pengguna,
        peran: badan.data.peran,
        kataSandiHash,
      });
      if (!hasil.berhasil) {
        kirimKesalahan(res, 409, KODE.dataSudahAda, hasil.pesan);
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      kirimData(res, 201, {
        id: hasil.data.id,
        nama_pengguna: hasil.data.namaPengguna,
        kata_sandi_awal: kataSandiAwal,
      });
    }),
  );

  ruta.get(
    "/api/pengguna",
    ...harusAdmin,
    bungkus(async (req, res) => {
      if (!queryKosongSkema.safeParse(req.query).success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Daftar pengguna tidak menerima parameter query.",
        );
        return;
      }
      const hasil = await daftarPengguna(deps.db);
      kirimData(
        res,
        200,
        hasil.map((item) => ({
          id: item.id,
          nama: item.nama,
          nama_pengguna: item.namaPengguna,
          peran: item.peran,
          aktif: item.aktif,
        })),
      );
    }),
  );

  ruta.post(
    "/api/pengguna/unggah",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const penuntut = req.penuntut!;
      const sekarang = deps.sekarang();
      const jatah = await pakaiJatahUnggah(deps.db, penuntut.penggunaRef, sekarang);
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
      const bidang = bidangUnggahSkema.safeParse(multipart.bidang);
      if (!bidang.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Bidang peran wajib bernilai guru atau siswa dan tidak boleh memuat bidang lain.",
        );
        return;
      }

      const terurai = await deps.berkasAdministrasi.uraiAkunCsv(
        multipart.berkas,
        bidang.data.peran,
      );
      if (!terurai.berhasil) {
        kirimKesalahan(res, 400, KODE.berkasTidakSah, terurai.sebab);
        return;
      }

      const rincianBasisData = await rincianKonflikPenggunaUnggah(deps.db, terurai.valid);
      const rincian = gabungRincian(
        terurai.bermasalah,
        rincianPanjang(terurai.valid),
        rincianDuplikat(terurai.valid),
        rincianBasisData,
      );
      const jumlahBaris = terurai.valid.length + terurai.bermasalah.length;
      if (jumlahBaris === 0) {
        kirimKesalahan(res, 400, KODE.berkasTidakSah, "Berkas tidak memuat satu pun baris akun.");
        return;
      }
      if (rincian.length > 0) {
        kirimKesalahan(
          res,
          400,
          KODE.berkasTidakSah,
          pesanBerkas(rincian.length, jumlahBaris),
          rincian,
        );
        return;
      }

      const kredensial = Object.freeze(
        terurai.valid.map((item) =>
          Object.freeze({
            ...item,
            peran: bidang.data.peran,
            kataSandiAwal: deps.kataSandi.buatAwal(),
          }),
        ),
      );
      const hash = await hashKataSandiTerbatas(
        deps.kataSandi,
        kredensial.map((item) => item.kataSandiAwal),
      );
      // Siapkan berkas sebelum transaksi: kegagalan adapter tidak boleh
      // meninggalkan akun yang kata sandi awalnya tidak pernah tersampaikan.
      const csv = await deps.berkasAdministrasi.buatCsvKredensial(
        kredensial.map((item) => ({
          nama: item.nama,
          namaPengguna: item.namaPengguna,
          kataSandiAwal: item.kataSandiAwal,
        })),
      );
      const hasil = await buatBanyakPengguna(
        deps.db,
        kredensial.map((item, indeks) => ({
          baris: item.baris,
          nama: item.nama,
          namaPengguna: item.namaPengguna,
          peran: item.peran,
          kataSandiHash: hash[indeks]!,
        })),
      );
      if (!hasil.berhasil) {
        kirimKesalahan(
          res,
          hasil.jenis === "berkas_tidak_sah" ? 400 : 409,
          hasil.jenis === "berkas_tidak_sah" ? KODE.berkasTidakSah : KODE.dataSudahAda,
          hasil.pesan,
          hasil.rincian,
        );
        return;
      }

      res.status(200);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="kredensial-${bidang.data.peran}-${tanggalJakarta(sekarang)}.csv"`,
      );
      res.send(csv);
    }),
  );

  ruta.post(
    "/api/pengguna/:id/kata-sandi",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const params = paramsResetSkema.safeParse(req.params);
      const badan = badanKosongSkema.safeParse(req.body === undefined ? {} : req.body);
      if (!params.success || !badan.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Pengenal pengguna atau badan permintaan tidak sah.",
        );
        return;
      }

      const kataSandiAwal = deps.kataSandi.buatAwal();
      const hashBaru = await deps.kataSandi.hash(kataSandiAwal);
      const hasil = await resetKataSandi(deps.db, params.data.id, hashBaru);
      if (!hasil.berhasil) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      kirimData(res, 200, { kata_sandi_awal: kataSandiAwal });
    }),
  );

  return ruta;
}

function rincianDuplikat(
  input: readonly Readonly<{ baris: number; namaPengguna: string }>[],
): readonly RincianBerkas[] {
  const frekuensi = new Map<string, number>();
  for (const item of input) {
    const kunci = item.namaPengguna.toLowerCase();
    frekuensi.set(kunci, (frekuensi.get(kunci) ?? 0) + 1);
  }
  return Object.freeze(
    input.flatMap((item) =>
      (frekuensi.get(item.namaPengguna.toLowerCase()) ?? 0) > 1
        ? [Object.freeze({ baris: item.baris, sebab: "Nama pengguna muncul lebih dari sekali." })]
        : [],
    ),
  );
}

function rincianPanjang(
  input: readonly Readonly<{ baris: number; nama: string; namaPengguna: string }>[],
): readonly RincianBerkas[] {
  return Object.freeze(
    input.flatMap((item) => {
      const sebab = [
        ...(item.nama.length > 128 ? ["Kolom Nama paling panjang 128 karakter"] : []),
        ...(item.namaPengguna.length > 32 ? ["NIP atau NIS paling panjang 32 karakter"] : []),
      ];
      return sebab.length > 0
        ? [Object.freeze({ baris: item.baris, sebab: sebab.join("; ") })]
        : [];
    }),
  );
}

function gabungRincian(
  ...kelompok: readonly (readonly RincianBerkas[])[]
): readonly RincianBerkas[] {
  const menurutBaris = new Map<number, Set<string>>();
  for (const rincian of kelompok.flat()) {
    const sebab = menurutBaris.get(rincian.baris) ?? new Set<string>();
    sebab.add(rincian.sebab);
    menurutBaris.set(rincian.baris, sebab);
  }
  return Object.freeze(
    [...menurutBaris.entries()]
      .sort(([a], [b]) => a - b)
      .map(([baris, sebab]) => Object.freeze({ baris, sebab: [...sebab].join("; ") })),
  );
}

function pesanBerkas(bermasalah: number, jumlah: number): string {
  return `Berkas tidak dapat diproses. ${bermasalah} dari ${jumlah} baris bermasalah dan tidak ada akun yang dibuat.`;
}

function tanggalJakarta(sekarang: Date): string {
  const bagian = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(sekarang);
  const nilai = Object.fromEntries(bagian.map((item) => [item.type, item.value]));
  return `${nilai.year}-${nilai.month}-${nilai.day}`;
}
