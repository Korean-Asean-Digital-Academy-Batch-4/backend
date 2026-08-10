import { createHash, randomBytes } from "node:crypto";

import { eq, lte } from "drizzle-orm";
import type { Pool } from "pg";

import { hitungKedaluwarsa } from "../domain/sesi.js";
import type { BasisData } from "./drizzle.js";
import { pengguna } from "./skema/identitas.js";
import { sesiMasuk } from "./skema/penopang.js";

/**
 * Sesi masuk sebagai baris basis data yang dapat dicabut — CK-A-04.
 *
 * Yang tersimpan adalah **SHA-256 atas token**, bukan tokennya (CK-S-06).
 * Akibatnya salinan basis data mana pun — cadangan, dump pengembangan, maupun
 * basis data yang bocor — tidak memuat satu pun sesi yang dapat dipakai masuk.
 * Argon2id tidak diperlukan di sini karena masukannya sudah acak penuh sehingga
 * tidak dapat ditebak, berbeda dari kata sandi buatan manusia.
 */

/** 256 bit. Cukup untuk menjadikan penebakan tidak berarti. */
const PANJANG_TOKEN_BYTE = 32;

export type SesiSah = {
  readonly penggunaRef: string;
  readonly peran: string;
};

export type SesiBaru = {
  readonly token: string;
  readonly kedaluwarsaPada: Date;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Membuat sesi baru dan mengembalikan tokennya.
 *
 * Token dikembalikan **satu kali saja** — ia tidak dapat dibaca ulang dari basis
 * data karena yang tersimpan hanya hash-nya.
 *
 * Sekalian membersihkan sesi yang sudah kedaluwarsa. Tidak ada worker maupun
 * penjadwal (CK-07), sehingga pembersihan menumpang pada penulisan yang memang
 * terjadi — dilayani `idx_sesi_masuk_kedaluwarsa`.
 */
export async function buatSesi(pool: Pool, penggunaRef: string, sekarang: Date): Promise<SesiBaru> {
  const token = randomBytes(PANJANG_TOKEN_BYTE).toString("base64url");
  const kedaluwarsaPada = hitungKedaluwarsa(sekarang);

  await pool.query(`DELETE FROM sesi_masuk WHERE kedaluwarsa_pada <= $1`, [sekarang]);
  await pool.query(
    `INSERT INTO sesi_masuk (token_hash, pengguna_ref, dibuat_pada, kedaluwarsa_pada)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(token), penggunaRef, sekarang, kedaluwarsaPada],
  );

  return { token, kedaluwarsaPada };
}

/**
 * Membuat sesi hanya bila hash yang baru diverifikasi masih berlaku.
 *
 * Argon2 selesai sebelum fungsi ini dipanggil. Lock baris pengguna kemudian
 * menyerialkan pembuatan sesi dengan reset Administrator: bila login menang,
 * reset berikutnya menghapus sesinya; bila reset menang, hash tidak lagi sama
 * dan kredensial lama tidak memperoleh sesi baru.
 */
export async function buatSesiJikaHashTetap(
  db: BasisData,
  penggunaRef: string,
  hashTerverifikasi: string,
  sekarang: Date,
): Promise<SesiBaru | null> {
  const token = randomBytes(PANJANG_TOKEN_BYTE).toString("base64url");
  const kedaluwarsaPada = hitungKedaluwarsa(sekarang);

  return db.transaction(async (tx) => {
    const [akun] = await tx
      .select({ aktif: pengguna.aktif, kataSandiHash: pengguna.kataSandiHash })
      .from(pengguna)
      .where(eq(pengguna.id, penggunaRef))
      .for("update");
    if (!akun || !akun.aktif || akun.kataSandiHash !== hashTerverifikasi) return null;

    await tx.delete(sesiMasuk).where(lte(sesiMasuk.kedaluwarsaPada, sekarang));
    await tx.insert(sesiMasuk).values({
      tokenHash: hashToken(token),
      penggunaRef,
      dibuatPada: sekarang,
      kedaluwarsaPada,
    });
    return { token, kedaluwarsaPada };
  });
}

/**
 * Sesi yang masih berlaku beserta peran pemiliknya, atau `null`.
 *
 * Peran dibaca dari basis data pada **setiap** request, bukan dititipkan pada
 * token — ARCHITECTURE.md §9.2. Akibatnya perubahan peran maupun penonaktifan
 * akun berlaku pada request berikutnya tanpa menunggu sesi habis.
 *
 * `pengguna.aktif` ikut diperiksa di sini: akun yang dinonaktifkan Administrator
 * kehilangan aksesnya seketika, bukan setelah dua belas jam.
 */
export async function cariSesiSah(
  pool: Pool,
  token: string,
  sekarang: Date,
): Promise<SesiSah | null> {
  const hasil = await pool.query<{ pengguna_ref: string; peran: string }>(
    `SELECT s.pengguna_ref, p.peran
     FROM sesi_masuk s
     JOIN pengguna   p ON p.id = s.pengguna_ref
     WHERE s.token_hash = $1 AND s.kedaluwarsa_pada > $2 AND p.aktif`,
    [hashToken(token), sekarang],
  );

  const baris = hasil.rows[0];
  return baris ? { penggunaRef: baris.pengguna_ref, peran: baris.peran } : null;
}

/** Mencabut satu sesi. Berlaku seketika pada request berikutnya. */
export async function cabutSesi(pool: Pool, token: string): Promise<void> {
  await pool.query(`DELETE FROM sesi_masuk WHERE token_hash = $1`, [hashToken(token)]);
}

/**
 * Mencabut seluruh sesi milik satu pengguna, kecuali satu yang boleh bertahan.
 *
 * Dipakai pada penggantian kata sandi: [API.md §3.2] mempertahankan sesi yang
 * sedang dipakai dan mencabut sisanya, sehingga penggantian kata sandi
 * mengeluarkan penyusup tanpa mengeluarkan pemiliknya sendiri.
 */
export async function cabutSeluruhSesi(
  pool: Pool,
  penggunaRef: string,
  kecualiToken?: string,
): Promise<void> {
  if (kecualiToken === undefined) {
    await pool.query(`DELETE FROM sesi_masuk WHERE pengguna_ref = $1`, [penggunaRef]);
    return;
  }

  await pool.query(`DELETE FROM sesi_masuk WHERE pengguna_ref = $1 AND token_hash <> $2`, [
    penggunaRef,
    hashToken(kecualiToken),
  ]);
}
