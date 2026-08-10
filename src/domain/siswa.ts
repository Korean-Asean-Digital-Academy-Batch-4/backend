import { hitungNilaiAkhir, type Komponen, type NilaiKomponen } from "./nilai.js";

/**
 * Pembentukan bentuk nilai per siswa — tanpa I/O, tanpa basis data.
 *
 * API.md §6.1 mengembalikan daftar memanjang; pemutaran menjadi matriks 30 × 8
 * dilakukan frontend. Berkas ini hanya menyediakan pivot Map agar lapisan db
 * tidak mengulang perulangan O(n·m) per sel, serta nilai akhir per siswa untuk
 * GET /api/saya/nilai dan GET /api/kelas/:id/nilai (API.md §9).
 */

/** Satu baris nilai dari basis data. */
export type BarisNilai = Readonly<{
  siswaRef: string;
  komponenRef: string;
  nilai: number;
}>;

/** Komponen penugasan dengan pengenal basis data. */
export type KomponenPenugasan = Komponen & Readonly<{ id: string }>;

/** Hasil nilai akhir per siswa untuk bentuk API. */
export type NilaiAkhirSiswa =
  Readonly<{ lengkap: true; nilaiAkhir: number }> | Readonly<{ lengkap: false; nilaiAkhir: null }>;

/**
 * Mengubah daftar memanjang menjadi `Map<siswaRef, Map<komponenRef, nilai>>`.
 *
 * Pencarian O(1) per sel menggantikan `find` per pasangan — matriks 30 × 8
 * berarti 240 pencarian, masing-masing atas 240 baris, bila tanpa pivot.
 */
export function pivotBarisNilai(baris: readonly BarisNilai[]): Map<string, Map<string, number>> {
  const peta = new Map<string, Map<string, number>>();
  for (const satu of baris) {
    let milikSiswa = peta.get(satu.siswaRef);
    if (!milikSiswa) {
      milikSiswa = new Map();
      peta.set(satu.siswaRef, milikSiswa);
    }
    milikSiswa.set(satu.komponenRef, satu.nilai);
  }
  return peta;
}

/**
 * Nilai akhir satu siswa atas satu penugasan.
 *
 * Memakai `hitungNilaiAkhir` dari domain/nilai — tidak ada rumus yang
 * diduplikasi di sini (ketentuan pengguna wajib memakai fungsi domain).
 * Nilai akhir hanya ada apabila seluruh komponen terisi (PRD §8.3, AC-06);
 * keadaan belum lengkap dinyatakan lewat tipe, bukan angka pengganti.
 */
export function bentukNilaiAkhirSiswa(
  komponen: readonly KomponenPenugasan[],
  seluruh: readonly BarisNilai[],
  siswaRef: string,
): NilaiAkhirSiswa {
  const milikSiswa = seluruh.filter((satu) => satu.siswaRef === siswaRef);
  const nilaiKomponen: readonly NilaiKomponen[] = milikSiswa.map((satu) => ({
    kode: komponen.find((k) => k.id === satu.komponenRef)?.kode ?? "",
    nilai: satu.nilai,
  }));

  const hasil = hitungNilaiAkhir(
    komponen.map((k) => ({ kode: k.kode, bobot: k.bobot })),
    nilaiKomponen,
  );

  return hasil.sah
    ? { lengkap: true, nilaiAkhir: hasil.nilaiAkhir }
    : { lengkap: false, nilaiAkhir: null };
}
