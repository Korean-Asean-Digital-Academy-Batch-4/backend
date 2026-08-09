import type { Pool } from "pg";

/**
 * Pembacaan akun bagi jalur masuk dan bagi `GET /api/saya`.
 *
 * `penugasan` dan `wali_kelas` disertakan sejak masuk karena keduanya
 * menentukan menu yang boleh tampil (UC-01, [API.md §3.1]). `wali_kelas` yang
 * kosong adalah satu-satunya penanda bahwa menu finalisasi tidak boleh
 * dirender — sesuai CK-A-01, kewenangan Wali Kelas tidak berupa peran.
 */

export type AkunMasuk = {
  readonly id: string;
  readonly nama: string;
  readonly peran: string;
  readonly aktif: boolean;
  readonly kataSandiHash: string;
};

export type Penugasan = {
  readonly id: string;
  readonly kelasNama: string;
  readonly mapelNama: string;
};

export type WaliKelas = {
  readonly kelasRef: string;
  readonly kelasNama: string;
};

export type KonteksPengguna = {
  readonly penugasan: Penugasan[];
  readonly waliKelas: WaliKelas[];
};

/**
 * Akun berdasarkan pengenal masuknya, tidak peka huruf besar-kecil (I-02).
 *
 * Mengembalikan akun **nonaktif juga**. Penolakannya dikerjakan lapisan rute
 * dengan kode dan pesan yang sama seperti kata sandi salah, supaya keberadaan
 * akun tidak terungkap ([API.md §3.1]). Menyaringnya di kueri ini akan
 * membedakan lama jawaban antara akun nonaktif dan akun yang tidak ada.
 */
export async function cariPenggunaUntukMasuk(
  pool: Pool,
  namaPengguna: string,
): Promise<AkunMasuk | null> {
  const hasil = await pool.query<{
    id: string;
    nama: string;
    peran: string;
    aktif: boolean;
    kata_sandi_hash: string;
  }>(
    `SELECT id, nama, peran, aktif, kata_sandi_hash
     FROM pengguna WHERE lower(nama_pengguna) = lower($1)`,
    [namaPengguna],
  );

  const baris = hasil.rows[0];
  if (!baris) return null;

  return {
    id: baris.id,
    nama: baris.nama,
    peran: baris.peran,
    aktif: baris.aktif,
    kataSandiHash: baris.kata_sandi_hash,
  };
}

/**
 * Penugasan dan kelas yang diwalikan seorang pengguna.
 *
 * Bagi Administrator dan Siswa keduanya selalu kosong; kuerinya tetap
 * dijalankan tanpa percabangan peran karena hasilnya memang kosong dengan
 * sendirinya, dan percabangan hanya menambah jalur yang perlu diuji.
 */
export async function muatKonteksPengguna(
  pool: Pool,
  penggunaRef: string,
): Promise<KonteksPengguna> {
  const penugasan = await pool.query<{ id: string; kelas_nama: string; mapel_nama: string }>(
    `SELECT pg.id, k.nama AS kelas_nama, m.nama AS mapel_nama
     FROM penugasan pg
     JOIN kelas k ON k.id = pg.kelas_ref
     JOIN mapel m ON m.id = pg.mapel_ref
     WHERE pg.guru_ref = $1
     ORDER BY k.nama`,
    [penggunaRef],
  );

  const wali = await pool.query<{ kelas_ref: string; kelas_nama: string }>(
    `SELECT id AS kelas_ref, nama AS kelas_nama
     FROM kelas WHERE wali_kelas_ref = $1 ORDER BY nama`,
    [penggunaRef],
  );

  return {
    penugasan: penugasan.rows.map((b) => ({
      id: b.id,
      kelasNama: b.kelas_nama,
      mapelNama: b.mapel_nama,
    })),
    waliKelas: wali.rows.map((b) => ({ kelasRef: b.kelas_ref, kelasNama: b.kelas_nama })),
  };
}
