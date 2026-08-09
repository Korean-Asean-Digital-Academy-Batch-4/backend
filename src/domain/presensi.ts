import { SEN_PER_SATUAN, bagiBulatSetengahKeAtas, dariSen } from "./angka.js";

/**
 * Perhitungan persentase kehadiran. Tanpa I/O, tanpa basis data.
 *
 * Berkas ini memikul I-17 dan I-18 sendirian. [SCHEMA.md §5.1] menyatakan
 * keduanya TIDAK dapat ditegakkan basis data: yang satu aturan perhitungan, yang
 * lain bentuk kueri agregat. Kekeliruan di sini menghasilkan angka salah pada
 * rapor tanpa ditolak siapa pun.
 *
 * [PRD.md §8.4]:
 *
 *     Persentase = jumlah sesi Hadir, Izin, atau Sakit
 *                  ÷ jumlah sesi yang dibuka Guru × 100%
 */

/** Himpunan tertutup, sama persis dengan `ck_presensi_status`. */
export const STATUS_PRESENSI = ["hadir", "izin", "sakit", "alpa"] as const;

/** Kehadiran dinyatakan dalam persen, sesuai `numeric(5,2)` pada `rapor_mapel`. */
const PERSEN_PENUH = 100;

export type StatusPresensi = (typeof STATUS_PRESENSI)[number];

export type HasilKehadiran =
  { readonly adaSesi: true; readonly persen: number } | { readonly adaSesi: false };

/**
 * I-17 — Izin dan Sakit terhitung sebagai kehadiran.
 *
 * Ditulis sebagai "bukan alpa" dan bukan sebagai daftar tiga status, supaya
 * penambahan status baru kelak tidak diam-diam terhitung mengurangi kehadiran.
 * P16 dan AC-29 menyatakan **hanya Alpa** yang mengurangi persentase.
 */
export function terhitungHadir(status: StatusPresensi): boolean {
  return status !== "alpa";
}

/**
 * I-18 — penyebutnya adalah jumlah sesi yang dibuka Guru.
 *
 * Karena I-15 menjamin setiap sesi memuat seluruh siswa kelas, jumlah baris
 * presensi milik satu siswa pada satu penugasan sama dengan jumlah sesi yang
 * dibuka. Daftar yang diterima fungsi ini adalah baris-baris tersebut.
 *
 * Ketiadaan sesi dinyatakan lewat tipe, bukan lewat 0 persen: nol persen berarti
 * siswa selalu alpa, sedangkan tidak ada sesi berarti tidak ada yang diketahui
 * sistem — dan [PRD.md §8.4] menyatakan pertemuan yang sesinya tidak pernah
 * dibuka tidak memengaruhi perhitungan.
 */
export function hitungPersentaseKehadiran(status: readonly StatusPresensi[]): HasilKehadiran {
  if (status.length === 0) {
    return { adaSesi: false };
  }

  const hadir = status.filter(terhitungHadir).length;
  const persenSen = bagiBulatSetengahKeAtas(hadir * PERSEN_PENUH * SEN_PER_SATUAN, status.length);

  return { adaSesi: true, persen: dariSen(persenSen) };
}
