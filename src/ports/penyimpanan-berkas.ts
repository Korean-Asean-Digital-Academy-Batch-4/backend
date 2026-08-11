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

/**
 * Kunci yang diterima: segmen `A-Z a-z 0-9 _ - .` yang dipisahkan `/`.
 *
 * Sengaja dibuat sempit alih-alih menyaring `..` satu per satu. Daftar larangan
 * selalu tertinggal dari cara baru menuliskan hal yang sama — penyandian persen,
 * pemisah Windows, byte nol — sedangkan daftar izin tidak.
 *
 * Berada di port, bukan di salah satu adapter, karena bentuk kunci adalah bagian
 * dari kontrak: berkas yang tersimpan di disk lokal harus dapat dipindahkan ke
 * S3 tanpa satu pun nama berubah arti ([ARCHITECTURE.md §13]).
 */
const POLA_KUNCI = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*(\/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*)*$/;

export function pastikanKunciSah(kunci: string): string {
  if (!POLA_KUNCI.test(kunci) || kunci.split("/").includes("..")) {
    throw new Error(`Kunci berkas tidak sah: ${JSON.stringify(kunci)}`);
  }
  return kunci;
}

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
