/**
 * Perhitungan jendela pembatas laju. Tanpa I/O, tanpa basis data.
 *
 * [ARCHITECTURE.md Pasal 7] menetapkan pembatasan berada **di dalam Express**
 * dengan penghitung di PostgreSQL, sehingga batas tetap berlaku meskipun setiap
 * instance Lambda memiliki memorinya sendiri (CK-A-03). Berkas ini hanya
 * menghitung jendelanya; penyimpanannya ada pada `db/pembatas-laju.ts`.
 */

/** Lima percobaan **gagal** — ARCHITECTURE.md Pasal 7. */
export const BATAS_MASUK = 5;

/** Lima belas menit — ARCHITECTURE.md Pasal 7. */
export const JENDELA_MASUK_MS = 15 * 60 * 1000;

/**
 * Awal jendela tetap yang memuat `sekarang`.
 *
 * Jendela tetap, bukan jendela bergulir. Bentuk tetap menjadikan kuncinya
 * `(kunci, jendela_mulai)` sehingga penghitungnya satu baris yang dapat
 * di-`UPSERT`, dan jendela lama dapat dihapus pada pernyataan yang sama tanpa
 * pekerjaan latar (CK-07). Jendela bergulir menuntut penyimpanan setiap
 * percobaan beserta waktunya, yang berarti tabel yang tumbuh.
 */
export function awalJendela(sekarang: Date, panjangMs: number): Date {
  return new Date(Math.floor(sekarang.getTime() / panjangMs) * panjangMs);
}

/** Apakah percobaan berikutnya masih di dalam batas. */
export function bolehMencoba(jumlahTercatat: number, batas: number): boolean {
  return jumlahTercatat < batas;
}

/**
 * Momen percobaan berikutnya dapat dilakukan, yaitu awal jendela berikutnya.
 *
 * Dipakai mengisi `coba_lagi_pada` pada respons `429` — [API.md §10]
 * mewajibkan `429` menyebutkan kapan dapat dicoba kembali (P21).
 */
export function cobaLagiPada(sekarang: Date, panjangMs: number): Date {
  return new Date(awalJendela(sekarang, panjangMs).getTime() + panjangMs);
}
