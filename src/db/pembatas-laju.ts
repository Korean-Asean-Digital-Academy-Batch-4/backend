import type { Pool } from "pg";

import { awalJendela, cobaLagiPada } from "../domain/pembatas-laju.js";

/**
 * Penghitung pembatas laju di PostgreSQL — CK-A-03.
 *
 * Setiap instance Lambda memiliki memorinya sendiri, sehingga penghitung di
 * memori proses hanya membatasi per instance dan dapat dilampaui cukup dengan
 * menunggu instance baru menyala. Penyimpanannya karenanya di basis data.
 *
 * Yang dihitung adalah **kegagalan**, bukan seluruh percobaan
 * ([ARCHITECTURE.md Pasal 7]), sehingga pengguna yang berhasil masuk tidak
 * menggerus jatahnya sendiri.
 */

export type HasilPeriksaBatas =
  { readonly boleh: true } | { readonly boleh: false; readonly cobaLagiPada: Date };

/** Apakah percobaan berikutnya masih di dalam batas pada jendela saat ini. */
export async function periksaBatas(
  pool: Pool,
  kunci: string,
  sekarang: Date,
  batas: number,
  panjangJendelaMs: number,
): Promise<HasilPeriksaBatas> {
  const mulai = awalJendela(sekarang, panjangJendelaMs);

  const hasil = await pool.query<{ jumlah: number }>(
    `SELECT jumlah FROM pembatas_laju WHERE kunci = $1 AND jendela_mulai = $2`,
    [kunci, mulai],
  );

  const jumlah = hasil.rows[0]?.jumlah ?? 0;
  return jumlah < batas
    ? { boleh: true }
    : { boleh: false, cobaLagiPada: cobaLagiPada(sekarang, panjangJendelaMs) };
}

/**
 * Menambah satu kegagalan pada jendela saat ini.
 *
 * Sekalian menghapus jendela yang sudah lewat untuk kunci yang sama, di dalam
 * pernyataan yang sama — [SCHEMA.md §4.7]. Tabel dengan demikian tetap kecil
 * tanpa worker maupun penjadwal (CK-07).
 *
 * `ON CONFLICT` menjadikan penambahan ini aman terhadap dua permintaan
 * bersamaan: keduanya menaikkan penghitung yang sama, bukan saling menimpa.
 */
export async function catatKegagalan(
  pool: Pool,
  kunci: string,
  sekarang: Date,
  panjangJendelaMs: number,
): Promise<void> {
  const mulai = awalJendela(sekarang, panjangJendelaMs);

  // Pembersihan LINTAS KUNCI, bukan hanya kunci ini. Kunci diturunkan dari
  // nama pengguna yang dikirim klien, sehingga permintaan dengan nama karangan
  // yang selalu berbeda menghasilkan baris yang tidak akan pernah dipakai lagi
  // — dan pembersihan per kunci tidak akan pernah menyentuhnya. Tabel dengan
  // demikian tetap terbatas pada jendela berjalan tanpa worker (CK-07).
  await pool.query(`DELETE FROM pembatas_laju WHERE jendela_mulai < $1`, [mulai]);
  await pool.query(
    `INSERT INTO pembatas_laju (kunci, jendela_mulai, jumlah) VALUES ($1, $2, 1)
     ON CONFLICT (kunci, jendela_mulai) DO UPDATE SET jumlah = pembatas_laju.jumlah + 1`,
    [kunci, mulai],
  );
}

/**
 * Menghapus penghitung sebuah kunci.
 *
 * Dipanggil sesudah masuk berhasil, sehingga rentetan kegagalan yang berakhir
 * dengan keberhasilan tidak menyisakan jatah yang sudah terpakai.
 */
export async function hapusPenghitung(pool: Pool, kunci: string): Promise<void> {
  await pool.query(`DELETE FROM pembatas_laju WHERE kunci = $1`, [kunci]);
}
