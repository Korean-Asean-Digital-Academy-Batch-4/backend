/**
 * Umur dan kedaluwarsa sesi masuk. Tanpa I/O, tanpa basis data.
 *
 * [ARCHITECTURE.md §9.1] menetapkan **12 jam tanpa perpanjangan otomatis**.
 * Polanya harian: pengguna masuk pagi dan selesai sore, lalu masuk kembali
 * keesokan paginya. Perpanjangan bergulir menambah mekanisme yang perlu ditulis
 * dan diuji tanpa menjawab kebutuhan yang ada.
 */

/** Dua belas jam. Cukup untuk satu hari kerja sekolah — ARCHITECTURE.md §9.1. */
export const UMUR_SESI_MS = 12 * 60 * 60 * 1000;

/** Momen kedaluwarsa bagi sesi yang dibuat pada `dibuatPada`. */
export function hitungKedaluwarsa(dibuatPada: Date): Date {
  return new Date(dibuatPada.getTime() + UMUR_SESI_MS);
}

/**
 * Apakah sesi sudah tidak berlaku pada `sekarang`.
 *
 * Tepat pada momen kedaluwarsanya sesi dinyatakan **sudah** habis, bukan masih
 * berlaku: batas yang inklusif menyisakan satu momen yang perlakuannya berbeda
 * antara pembacaan kode dan pembacaan `ck_sesi_masuk_umur`.
 */
export function sudahKedaluwarsa(kedaluwarsaPada: Date, sekarang: Date): boolean {
  return sekarang.getTime() >= kedaluwarsaPada.getTime();
}
