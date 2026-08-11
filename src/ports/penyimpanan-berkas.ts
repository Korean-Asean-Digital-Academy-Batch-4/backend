/**
 * Port penyimpanan berkas. Menyembunyikan pilihan penyimpanan dari lapisan rute.
 *
 * [ARCHITECTURE.md §11.1] menetapkan bucket rapor bersifat privat dan disajikan
 * lewat tautan bertanda tangan berumur pendek — isi berkas tidak pernah melewati
 * proses aplikasi. Rute hanya mengenal antarmuka ini, sehingga penukaran S3
 * dengan MinIO maupun disk lokal ([ARCHITECTURE.md §13]) tidak menyentuh satu
 * pun berkas rute.
 */

/** Tautan bertanda tangan beserta batas berlakunya. */
export type TautanBerkas = Readonly<{
  url: string;
  kedaluwarsaPada: Date;
}>;

/**
 * Umur tautan unduh: **5 menit** — [ARCHITECTURE.md §11.1].
 *
 * Cukup bagi browser memulai unduhan, terlalu pendek untuk disalin dan
 * disebarkan kepada orang yang tidak berhak.
 */
export const UMUR_TAUTAN_DETIK = 5 * 60;

export interface PenyimpananBerkas {
  /** Menyimpan atau menimpa satu berkas. */
  simpan(kunci: string, isi: Buffer, jenisIsi: string): Promise<void>;

  /** Apakah berkasnya sudah ada — penentu render-saat-unduh [API.md §8.4]. */
  ada(kunci: string): Promise<boolean>;

  /** Membaca isi berkas; `undefined` apabila tidak ada. */
  baca(kunci: string): Promise<Buffer | undefined>;

  /** Menghapus berkas. Berkas yang memang tidak ada bukan kegagalan (CK-A-05). */
  hapus(kunci: string): Promise<void>;

  /** Menerbitkan tautan bertanda tangan berumur pendek. */
  tautan(kunci: string, umurDetik: number): Promise<TautanBerkas>;
}
