/**
 * Aritmetika desimal bagi perhitungan yang hasilnya tercetak pada rapor.
 *
 * Seluruhnya bilangan bulat. CK-S-08 memilih `numeric` alih-alih pecahan biner
 * karena `real` tidak dapat menyatakan sebagian pecahan desimal secara tepat,
 * dan selisih pada digit terakhir tidak dapat dipertanggungjawabkan kepada orang
 * tua yang membaca rapor. Alasan yang sama berlaku bagi kode yang menghitungnya:
 * membagi dengan `/` lalu memangkas dengan `toFixed` memindahkan persoalannya,
 * tidak menghapusnya.
 */

/** Dua desimal, mengikuti `numeric(5,2)` dan [API.md §2.4]. */
export const SEN_PER_SATUAN = 100;

/**
 * Membagi dua bilangan bulat, membulatkan setengah ke atas, tanpa menyentuh
 * pecahan biner sama sekali.
 *
 * Bentuk `(2a + b) / 2b` dipilih karena seluruh sukunya tetap bilangan bulat
 * sampai pembagian terakhir, sehingga `Math.floor` bekerja atas nilai yang tepat
 * — berbeda dari `Math.round(a / b)` yang sudah kehilangan ketepatannya sebelum
 * pembulatan dimulai.
 *
 * @throws {RangeError} apabila penyebutnya nol atau negatif
 */
export function bagiBulatSetengahKeAtas(pembilang: number, penyebut: number): number {
  if (penyebut <= 0) {
    throw new RangeError(`Penyebut wajib lebih besar dari nol, diterima ${penyebut}`);
  }

  return Math.floor((2 * pembilang + penyebut) / (2 * penyebut));
}

/**
 * Mengubah angka menjadi bilangan bulat sen.
 *
 * **Prasyarat: masukan memiliki paling banyak dua desimal**, sesuai
 * [API.md §2.4] dan `numeric(5,2)`. Pada rentang itu galat pecahan biner selalu
 * jauh di bawah setengah sen, sehingga pembulatan memulihkan bilangan bulat yang
 * tepat. Di luar rentang itu hasilnya adalah pembulatan, bukan penerjemahan —
 * `1,005` menjadi `100`, bukan `101`, karena nilai binernya memang sedikit di
 * bawah 1,005. Penegakan prasyaratnya berada pada Zod di batas HTTP, bukan di
 * sini: `domain/` tidak menerima data luar secara langsung.
 */
export function keSen(nilai: number): number {
  return Math.round(nilai * SEN_PER_SATUAN);
}

/** Kebalikan {@link keSen}. */
export function dariSen(sen: number): number {
  return sen / SEN_PER_SATUAN;
}
