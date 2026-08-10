import { Router } from "express";
import { z } from "zod";

import type { DependensiApp } from "../../dependensi-app.js";
import {
  buatKelasAtomik,
  daftarKelas,
  detailKelas,
  type DetailKelas,
  type KelasDibuat,
  type RingkasanKelas,
} from "../../db/administrasi/kelas.js";
import { pakaiJatahUnggah } from "../../db/administrasi/pembatas-unggah.js";
import { pratinjauKelas } from "../../db/administrasi/pratinjau-kelas.js";
import { KODE, kirimData, kirimKesalahan } from "../amplop.js";
import { bungkus } from "../bungkus.js";
import { wajibAdministrator } from "../middleware-kewenangan.js";
import { wajibMasuk } from "../middleware-sesi.js";
import { bacaBerkasMultipart } from "../multipart.js";

const dataSkema = z
  .object({
    periode_ref: z.string().uuid(),
    nama: z.string().trim().min(1).max(32),
    tingkat: z.enum(["X", "XI", "XII"]),
    jurusan: z.string().trim().min(1).max(64),
    guru_ref: z.array(z.string().uuid()).min(1),
    wali_kelas_ref: z.string().uuid(),
  })
  .strict()
  .superRefine((nilai, ctx) => {
    if (new Set(nilai.guru_ref).size !== nilai.guru_ref.length) {
      ctx.addIssue({ code: "custom", path: ["guru_ref"], message: "Guru harus unik." });
    }
    if (!nilai.guru_ref.includes(nilai.wali_kelas_ref)) {
      ctx.addIssue({
        code: "custom",
        path: ["wali_kelas_ref"],
        message: "Wali kelas harus termasuk Guru yang dipilih.",
      });
    }
  });
const bidangSkema = z.object({ data: z.string().min(1) }).strict();
const paramsSkema = z.object({ id: z.string().uuid() }).strict();
const queryKosongSkema = z.object({}).strict();

export function rutaKelas(
  deps: Pick<DependensiApp, "pool" | "db" | "berkasAdministrasi" | "sekarang">,
): Router {
  const ruta = Router();
  const harusAdmin = [wajibMasuk(deps.pool), wajibAdministrator()] as const;

  ruta.post(
    "/api/kelas",
    ...harusAdmin,
    bungkus(async (req, res) => {
      // Percobaan tetap memakai jatah walaupun multipart atau isinya tidak sah.
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
      const dataMentah = bidang.success ? uraiJson(bidang.data.data) : undefined;
      const data = dataSkema.safeParse(dataMentah);
      if (!bidang.success || !data.success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Data kelas wajib berupa JSON sah tanpa bidang tambahan.",
        );
        return;
      }

      const terurai = await deps.berkasAdministrasi.uraiDaftarSiswaXlsx(multipart.berkas);
      const pratinjau = await pratinjauKelas(deps.db, data.data.periode_ref, terurai);
      if (!pratinjau.berhasil) {
        if (pratinjau.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, pratinjau.pesan);
        } else if (pratinjau.jenis === "berkas_tidak_sah") {
          kirimKesalahan(res, 400, KODE.berkasTidakSah, pratinjau.pesan, pratinjau.rincian);
        } else {
          throw new Error("Hasil pemeriksaan berkas kelas tidak didukung oleh rute.");
        }
        return;
      }
      if (!terurai.berhasil) {
        throw new Error("Parser berhasil dipetakan tetapi hasilnya tidak dapat dibaca.");
      }
      if (terurai.bermasalah.length > 0 || pratinjau.data.kelasBerkas !== data.data.nama) {
        kirimKesalahan(
          res,
          400,
          KODE.berkasTidakSah,
          "Seluruh siswa dan nilai Kelas di dalam berkas wajib sah dan cocok dengan data kelas.",
          terurai.bermasalah.map(({ baris, nis, sebab }) => ({ baris, nis, sebab })),
        );
        return;
      }

      const hasil = await buatKelasAtomik(deps.db, {
        periodeRef: data.data.periode_ref,
        nama: data.data.nama,
        tingkat: data.data.tingkat,
        jurusan: data.data.jurusan,
        guruRef: Object.freeze([...data.data.guru_ref]),
        waliKelasRef: data.data.wali_kelas_ref,
        siswa: Object.freeze(
          terurai.valid.map((item) =>
            Object.freeze({
              baris: item.baris,
              kelas: item.kelas,
              nis: item.nis,
              namaBerkas: item.nama,
            }),
          ),
        ),
      });
      if (!hasil.berhasil) {
        kirimGalatPembuatan(res, hasil);
        return;
      }
      kirimData(res, 201, kelasDibuatKeJson(hasil.data));
    }),
  );

  ruta.get(
    "/api/kelas",
    ...harusAdmin,
    bungkus(async (req, res) => {
      if (!queryKosongSkema.safeParse(req.query).success) {
        kirimKesalahan(
          res,
          400,
          KODE.permintaanTidakSah,
          "Daftar kelas tidak menerima parameter query.",
        );
        return;
      }
      kirimData(res, 200, (await daftarKelas(deps.db)).map(ringkasanKeJson));
    }),
  );

  ruta.get(
    "/api/kelas/:id",
    ...harusAdmin,
    bungkus(async (req, res) => {
      const params = paramsSkema.safeParse(req.params);
      if (!params.success || !queryKosongSkema.safeParse(req.query).success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal kelas tidak sah.");
        return;
      }
      const hasil = await detailKelas(deps.db, params.data.id);
      if (!hasil.berhasil) {
        if (hasil.jenis !== "tidak_ditemukan") {
          throw new Error("Hasil pembacaan detail kelas tidak didukung oleh rute.");
        }
        kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        return;
      }
      kirimData(res, 200, detailKeJson(hasil.data));
    }),
  );

  return ruta;
}

function uraiJson(nilai: string): unknown {
  try {
    return JSON.parse(nilai) as unknown;
  } catch {
    return undefined;
  }
}

function kirimGalatPembuatan(
  res: Parameters<typeof kirimKesalahan>[0],
  hasil: Exclude<Awaited<ReturnType<typeof buatKelasAtomik>>, { berhasil: true }>,
): void {
  if (hasil.jenis === "tidak_ditemukan") {
    kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan, hasil.rincian);
  } else if (hasil.jenis === "data_sudah_ada") {
    kirimKesalahan(res, 409, KODE.dataSudahAda, hasil.pesan, hasil.rincian);
  } else if (hasil.jenis === "guru_belum_mengampu") {
    kirimKesalahan(res, 409, KODE.guruBelumMengampu, hasil.pesan, hasil.rincian);
  } else if (hasil.jenis === "jenjang_tidak_cocok") {
    kirimKesalahan(res, 409, KODE.jenjangTidakCocok, hasil.pesan, hasil.rincian);
  } else if (hasil.jenis === "berkas_tidak_sah") {
    kirimKesalahan(res, 400, KODE.berkasTidakSah, hasil.pesan, hasil.rincian);
  } else {
    throw new Error("Hasil pembuatan kelas tidak didukung oleh rute.");
  }
}

function kelasDibuatKeJson(item: KelasDibuat): Record<string, unknown> {
  return {
    id: item.id,
    nama: item.nama,
    periode_ref: item.periodeRef,
    jumlah_siswa: item.jumlahSiswa,
    jumlah_penugasan: item.jumlahPenugasan,
  };
}

function ringkasanKeJson(item: RingkasanKelas): Record<string, unknown> {
  return {
    id: item.id,
    nama: item.nama,
    tingkat: item.tingkat,
    jurusan: item.jurusan,
    periode: {
      id: item.periode.id,
      semester: item.periode.semester,
      tahun_ajaran_nama: item.periode.tahunAjaranNama,
    },
    wali_kelas: { id: item.waliKelas.id, nama: item.waliKelas.nama },
    jumlah_siswa: item.jumlahSiswa,
    jumlah_penugasan: item.jumlahPenugasan,
  };
}

function detailKeJson(item: DetailKelas): Record<string, unknown> {
  return {
    ...ringkasanKeJson(item),
    siswa: item.siswa.map((siswa) => ({
      id: siswa.id,
      nama: siswa.nama,
      nama_pengguna: siswa.namaPengguna,
    })),
    penugasan: item.penugasan.map((penugasan) => ({
      id: penugasan.id,
      guru: { id: penugasan.guru.id, nama: penugasan.guru.nama },
      mapel: {
        id: penugasan.mapel.id,
        kode: penugasan.mapel.kode,
        nama: penugasan.mapel.nama,
        tingkat: penugasan.mapel.tingkat,
        kkm: penugasan.mapel.kkm,
      },
    })),
  };
}
