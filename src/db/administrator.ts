import type { Pool } from "pg";

import { buatKataSandiAwal } from "../adapters/local/kata-sandi.js";
import type { KataSandi } from "../ports/kata-sandi.js";
import { cabutSeluruhSesi } from "./sesi.js";

/**
 * Pembuatan dan penggantian kata sandi akun Administrator — ARCHITECTURE.md §9.3.
 *
 * Aplikasi **tidak memiliki layar maupun endpoint** pembuatan akun Administrator
 * dalam bentuk apa pun. Jalurnya hanya perintah CLI, sehingga tidak ada kata
 * sandi bawaan yang tertinggal di dalam repositori maupun berkas migrasi
 * ([SCHEMA.md §9.2]). Menutup temuan T-03 pada [RFC-001 §10].
 */

export type HasilAdministrator =
  | { readonly berhasil: true; readonly id: string; readonly kataSandiAwal: string }
  | { readonly berhasil: false; readonly sebab: string };

/** Kode PostgreSQL bagi pelanggaran keunikan. */
const PELANGGARAN_UNIK = "23505";

export async function buatAdministrator(
  pool: Pool,
  kataSandi: KataSandi,
  namaPengguna: string,
  nama: string,
): Promise<HasilAdministrator> {
  const kataSandiAwal = buatKataSandiAwal();
  const hash = await kataSandi.hash(kataSandiAwal);

  try {
    const hasil = await pool.query<{ id: string }>(
      `INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ($1, $2, 'administrator', $3) RETURNING id`,
      [namaPengguna, nama, hash],
    );

    const id = hasil.rows[0]?.id;
    if (!id) return { berhasil: false, sebab: "Akun gagal dibuat tanpa alasan yang diketahui." };

    return { berhasil: true, id, kataSandiAwal };
  } catch (galat) {
    // I-02 ditegakkan `uq_pengguna_nama_pengguna` atas `lower(nama_pengguna)`,
    // sehingga tabrakan huruf besar-kecil pun tertangkap di sini.
    if ((galat as { code?: string }).code === PELANGGARAN_UNIK) {
      return { berhasil: false, sebab: `Nama pengguna "${namaPengguna}" sudah dipakai.` };
    }
    throw galat;
  }
}

/**
 * Mengganti kata sandi sebuah akun dan **mencabut seluruh sesinya**.
 *
 * Berbeda dari penggantian oleh pemilik akun sendiri ([API.md §3.2]) yang
 * mempertahankan sesi yang sedang dipakai: penggantian lewat CLI dilakukan
 * ketika akunnya tidak dapat dimasuki lagi, sehingga tidak ada sesi yang layak
 * dipertahankan.
 */
export async function gantiKataSandi(
  pool: Pool,
  kataSandi: KataSandi,
  namaPengguna: string,
): Promise<HasilAdministrator> {
  const kataSandiAwal = buatKataSandiAwal();
  const hash = await kataSandi.hash(kataSandiAwal);

  const hasil = await pool.query<{ id: string }>(
    `UPDATE pengguna SET kata_sandi_hash = $1, diperbarui_pada = now()
     WHERE lower(nama_pengguna) = lower($2) RETURNING id`,
    [hash, namaPengguna],
  );

  const id = hasil.rows[0]?.id;
  if (!id) return { berhasil: false, sebab: `Akun "${namaPengguna}" tidak ditemukan.` };

  await cabutSeluruhSesi(pool, id);
  return { berhasil: true, id, kataSandiAwal };
}
