import type { Response } from "express";

/**
 * Amplop respons dan katalog kesalahan — API.md §2.2 dan §10.
 *
 * `data` dan `kesalahan` tidak pernah muncul bersamaan. `pesan` selalu siap
 * tampil kepada pengguna akhir dalam Bahasa Indonesia (P21, AC-27), sedangkan
 * `kode` dipakai frontend untuk menentukan perlakuan dan tidak diterjemahkan
 * ulang (CK-API-01).
 */

export const KODE = {
  kredensialSalah: "KREDENSIAL_SALAH",
  sesiTidakSah: "SESI_TIDAK_SAH",
  kewenanganDitolak: "KEWENANGAN_DITOLAK",
  permintaanTidakSah: "PERMINTAAN_TIDAK_SAH",
  batasLajuTerlampaui: "BATAS_LAJU_TERLAMPAUI",
  tidakDitemukan: "TIDAK_DITEMUKAN",
  berkasTidakSah: "BERKAS_TIDAK_SAH",
  berkasTerlaluBesar: "BERKAS_TERLALU_BESAR",
  bobotTidakSeratus: "BOBOT_TIDAK_SERATUS",
  dataSudahAda: "DATA_SUDAH_ADA",
  guruSudahMengampu: "GURU_SUDAH_MENGAMPU",
  guruBelumMengampu: "GURU_BELUM_MENGAMPU",
  komponenSudahDipakai: "KOMPONEN_SUDAH_DIPAKAI",
  jenjangTidakCocok: "JENJANG_TIDAK_COCOK",
  sesiSudahAda: "SESI_SUDAH_ADA",
  raporTerkunci: "RAPOR_TERKUNCI",
  mapelBelumLengkap: "MAPEL_BELUM_LENGKAP",
  berkasBelumSiap: "BERKAS_BELUM_SIAP",
  kesalahanServer: "KESALAHAN_SERVER",
} as const;

/**
 * Satu pesan untuk kredensial salah, akun tidak ada, dan akun nonaktif.
 *
 * Ketiganya dijawab sama persis — kode, teks, dan status — supaya keberadaan
 * akun tidak terungkap (API.md §3.1).
 */
export const PESAN_KREDENSIAL_SALAH = "Nama pengguna atau kata sandi tidak sesuai.";

export function kirimData(res: Response, status: number, data: unknown): void {
  res.status(status).json({ data });
}

export function kirimKesalahan(
  res: Response,
  status: number,
  kode: string,
  pesan: string,
  rincian?: readonly unknown[],
): void {
  res.status(status).json({
    kesalahan: { kode, pesan, ...(rincian ? { rincian } : {}) },
  });
}
