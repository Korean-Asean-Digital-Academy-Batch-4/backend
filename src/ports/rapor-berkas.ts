/**
 * Port berkas rapor — perenderan PDF dan penyusunan arsip.
 *
 * [ARCHITECTURE.md Pasal 11]: berkas dirender pada saat finalisasi, dengan
 * render-saat-unduh sebagai jalur cadangan yang tidak dapat dihapus (CK-A-07).
 * Unduh sekelas menyusun arsip dari berkas yang sudah ada — murni pekerjaan I/O.
 *
 * Pilihan pustaka berada di `adapters/`; rute dan lapisan data hanya mengenal
 * antarmuka ini.
 */

/**
 * Anggaran lunak perenderan: **20 detik** — [API.md §8.3].
 *
 * Batas waktu fungsi 30 detik ([ARCHITECTURE.md §6]) tidak boleh terlampaui,
 * sehingga berkas yang belum sempat dirender dilewati dan diselesaikan jalur
 * unduh. Melampaui anggaran **bukan kegagalan finalisasi**.
 */
export const ANGGARAN_RENDER_MS = 20_000;

/** Satu komponen sebagaimana dibekukan pada `rapor_mapel.snapshot_komponen`. */
export type KomponenCetak = Readonly<{
  kode: string;
  nama: string;
  bobot: number;
  nilai: number;
}>;

/** Satu mata pelajaran pada berkas rapor, dibaca dari salinan beku. */
export type MapelCetak = Readonly<{
  nama: string;
  kkm: number;
  nilaiAkhir: number;
  kehadiranPersen: number;
  komponen: readonly KomponenCetak[];
}>;

/**
 * Seluruh isi satu berkas rapor.
 *
 * Sumbernya **selalu** `rapor_mapel`, bukan tabel `nilai` — karena itu keluaran
 * PDF selalu sama dengan data yang difinalisasi (AC-13), meskipun templat bobot
 * berubah kemudian.
 */
export type IsiRapor = Readonly<{
  siswaNama: string;
  nis: string | null;
  kelasNama: string;
  periodeNama: string;
  waliKelasNama: string | null;
  catatanWali: string | null;
  difinalisasiPada: Date;
  mapel: readonly MapelCetak[];
}>;

/** Satu berkas anggota arsip. */
export type AnggotaArsip = Readonly<{
  nama: string;
  isi: Buffer;
}>;

export interface RaporBerkas {
  /** Merender satu berkas rapor menjadi PDF. */
  render(isi: IsiRapor): Promise<Buffer>;

  /** Menyusun beberapa berkas menjadi satu arsip ZIP. */
  arsipkan(anggota: readonly AnggotaArsip[]): Promise<Buffer>;
}
