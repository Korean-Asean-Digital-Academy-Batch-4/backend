/**
 * Perhitungan jendela pembatas laju. Tanpa I/O, tanpa basis data.
 *
 * [ARCHITECTURE.md Pasal 7] menetapkan pembatasan berada **di dalam Express**
 * dengan penghitung di PostgreSQL, sehingga batas tetap berlaku meskipun setiap
 * instance Lambda memiliki memorinya sendiri (CK-A-03). Berkas ini hanya
 * menghitung jendelanya; penyimpanannya ada pada `db/pembatas-laju.ts`.
 */

/** Lima kegagalan per akun — ARCHITECTURE.md Pasal 7, CK-A-08. */
export const BATAS_MASUK = 5;

/**
 * Tiga puluh kegagalan per alamat IP — CK-A-08.
 *
 * Sengaja jauh lebih longgar daripada batas per akun. Satu sekolah kerap berada
 * di balik satu alamat publik, sehingga ambang yang sama akan mengunci seluruh
 * sekolah karena kesalahan ketik beberapa orang. Lapis ini bukan untuk menahan
 * serangan atas satu akun — itu tugas BATAS_MASUK — melainkan untuk menahan
 * penyemprotan satu kata sandi atas ratusan akun sekaligus.
 */
export const BATAS_MASUK_IP = 30;

/** Lima belas menit — ARCHITECTURE.md Pasal 7. */
export const JENDELA_MASUK_MS = 15 * 60 * 1000;

/**
 * Lima penekanan tombol Suggestion per jam per siswa — ARCHITECTURE.md Pasal 7.
 *
 * Berbeda dari BATAS_MASUK, yang dihitung di sini adalah **setiap penekanan**,
 * bukan kegagalan: satu penekanan yang berhasil pun menggerus kredit KADA.
 */
export const BATAS_SUGGESTION = 5;

/** Satu jam — ARCHITECTURE.md Pasal 7. */
export const JENDELA_SUGGESTION_MS = 60 * 60 * 1000;

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
