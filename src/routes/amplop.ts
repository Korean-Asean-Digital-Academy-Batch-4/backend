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
  permintaanTidakSah: "PERMINTAAN_TIDAK_SAH",
  batasLajuTerlampaui: "BATAS_LAJU_TERLAMPAUI",
  tidakDitemukan: "TIDAK_DITEMUKAN",
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
  rincian?: unknown[],
): void {
  res.status(status).json({
    kesalahan: { kode, pesan, ...(rincian ? { rincian } : {}) },
  });
}
