import { Pool } from "pg";

/**
 * Mencabut seluruh data uji B7 — pasangan `benih-uji-render.ts`.
 *
 * ```bash
 * DATABASE_URL_MIGRASI=... npx tsx scripts/hapus-uji-render.ts
 * ```
 *
 * Seluruh barisnya dikenali dari awalan UUID `b7000000`, bukan dari daftar
 * pengenal yang ditulis tangan — daftar yang ditulis tangan akan tertinggal
 * ketika benihnya bertambah.
 *
 * **Wajib dijalankan sebelum data sekolah yang sesungguhnya dimuat.** Urutannya
 * mengikuti kunci asing dari daun ke akar; `ON DELETE CASCADE` hanya berlaku
 * dari `sesi` ke `presensi` (I-16), sisanya `RESTRICT`.
 */

const AWALAN = "b7000000-0000-4000-8000-%";

const url = process.env.DATABASE_URL_MIGRASI;
if (!url) throw new Error("DATABASE_URL_MIGRASI wajib diisi.");

const pool = new Pool({ connectionString: url, max: 1 });

const langkah: readonly (readonly [string, string])[] = [
  ["nilai", `DELETE FROM nilai WHERE penugasan_ref::text LIKE $1`],
  [
    "presensi",
    `DELETE FROM presensi WHERE sesi_ref IN (SELECT id FROM sesi WHERE penugasan_ref::text LIKE $1)`,
  ],
  ["sesi", `DELETE FROM sesi WHERE penugasan_ref::text LIKE $1`],
  [
    "rapor_mapel",
    `DELETE FROM rapor_mapel WHERE rapor_ref IN (SELECT id FROM rapor WHERE kelas_ref::text LIKE $1)`,
  ],
  ["rapor", `DELETE FROM rapor WHERE kelas_ref::text LIKE $1`],
  ["penugasan_komponen", `DELETE FROM penugasan_komponen WHERE penugasan_ref::text LIKE $1`],
  ["penugasan", `DELETE FROM penugasan WHERE id::text LIKE $1`],
  ["mapel", `DELETE FROM mapel WHERE id::text LIKE $1`],
  ["kelas_siswa", `DELETE FROM kelas_siswa WHERE kelas_ref::text LIKE $1`],
  ["kelas", `DELETE FROM kelas WHERE id::text LIKE $1`],
  ["periode", `DELETE FROM periode WHERE id::text LIKE $1`],
  ["tahun_ajaran", `DELETE FROM tahun_ajaran WHERE id::text LIKE $1`],
  ["guru", `DELETE FROM guru WHERE pengguna_ref::text LIKE $1`],
  ["siswa", `DELETE FROM siswa WHERE pengguna_ref::text LIKE $1`],
  ["sesi_masuk", `DELETE FROM sesi_masuk WHERE pengguna_ref::text LIKE $1`],
  ["pengguna", `DELETE FROM pengguna WHERE id::text LIKE $1`],
];

try {
  await pool.query("BEGIN");
  for (const [nama, sql] of langkah) {
    const { rowCount } = await pool.query(sql, [AWALAN]);
    if (rowCount) console.log(`${nama.padEnd(20)} ${rowCount} baris`);
  }
  await pool.query("COMMIT");
  console.log("Data uji B7 dicabut seluruhnya.");
} catch (galat) {
  await pool.query("ROLLBACK").catch(() => undefined);
  console.error(`Pencabutan gagal: ${galat instanceof Error ? galat.message : String(galat)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
