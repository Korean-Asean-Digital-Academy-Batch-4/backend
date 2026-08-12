import { Pool } from "pg";

import { kataSandiArgon2id } from "../src/adapters/local/kata-sandi.js";

/**
 * Benih data uji untuk pengukuran render B7 — [API.md §13.3].
 *
 * Menyiapkan satu kelas berisi **30 siswa** dan **10 mata pelajaran** yang
 * seluruh nilainya lengkap, sehingga finalisasi sekelas dapat dijalankan dan
 * lama render tiga puluh berkas rapor dapat diukur di dalam Lambda.
 *
 * Bentuknya sengaja sama dengan pembanding lokal `npm run ukur:render`, yang
 * memakai 30 rapor × 10 mata pelajaran. Angka yang dibandingkan karenanya
 * mengukur beban yang sama, dan yang berbeda hanya tempatnya berjalan.
 *
 * ```bash
 * DATABASE_URL_MIGRASI=... SANDI_UJI=... npx tsx scripts/benih-uji-render.ts
 * ```
 *
 * **Idempoten.** Dapat dijalankan berulang; seluruhnya `ON CONFLICT DO NOTHING`
 * kecuali rapor, yang dikembalikan ke `draft` dengan menghapus lalu menyisipkan
 * — I-21 melarang status mundur lewat `UPDATE`, dan invarian itu tidak pernah
 * dimatikan demi kenyamanan benih.
 *
 * ## Ini menulis ke basis data produksi
 *
 * Seluruh barisnya berawalan `b7-` dan ber-UUID berawalan `b7000000`, sehingga
 * dapat dicabut seluruhnya lewat `scripts/hapus-uji-render.ts`. **Wajib dicabut
 * sebelum data sekolah yang sesungguhnya dimuat** — lihat KEMAJUAN.md §5.
 */

const JUMLAH_SISWA = 30;
const JUMLAH_MAPEL = 10;

/** `uq_mapel_guru` membatasi satu mapel per guru, sehingga gurunya sebanyak mapelnya. */
const TINGKAT = "XII";

const P = "b7000000-0000-4000-8000-";
const id = (n: number) => `${P}${String(n).padStart(12, "0")}`;

const ADMIN = id(1);
const WALI = id(2);
const TAHUN = id(3);
const PERIODE = id(4);
const KELAS = id(5);
const guru = (i: number) => id(100 + i);
const mapel = (i: number) => id(200 + i);
const penugasan = (i: number) => id(300 + i);
const siswa = (i: number) => id(400 + i);

const url = process.env.DATABASE_URL_MIGRASI;
if (!url) throw new Error("DATABASE_URL_MIGRASI wajib diisi.");
const sandi = process.env.SANDI_UJI;
if (!sandi) throw new Error("SANDI_UJI wajib diisi — kata sandi akun Wali Kelas uji.");

const pool = new Pool({ connectionString: url, max: 2 });
const hash = await kataSandiArgon2id().hash(sandi);

/** Daftar berulang sebagai satu pernyataan, bukan satu pernyataan per baris. */
const deret = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

try {
  await pool.query("BEGIN");

  // Administrator hanya dipakai sebagai `diperbarui_oleh` pada nilai. Ia TIDAK
  // dapat masuk: hash-nya sengaja bukan hash yang sah, sehingga akun ini tidak
  // menambah satu pun jalan masuk ke sistem yang sesungguhnya.
  await pool.query(
    `INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash)
     VALUES ($1, 'b7-admin', 'Administrator Uji B7', 'administrator', 'x')
     ON CONFLICT DO NOTHING`,
    [ADMIN],
  );

  await pool.query(
    `INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash)
     VALUES ($1, 'b7-wali', 'Wali Kelas Uji B7', 'guru', $2)
     ON CONFLICT (id) DO UPDATE SET kata_sandi_hash = EXCLUDED.kata_sandi_hash`,
    [WALI, hash],
  );
  await pool.query(`INSERT INTO guru (pengguna_ref) VALUES ($1) ON CONFLICT DO NOTHING`, [WALI]);

  for (const i of deret(JUMLAH_MAPEL)) {
    await pool.query(
      `INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ($1, $2, $3, 'guru', 'x') ON CONFLICT DO NOTHING`,
      [guru(i), `b7-guru-${i}`, `Guru Uji B7 ${i}`],
    );
    await pool.query(`INSERT INTO guru (pengguna_ref) VALUES ($1) ON CONFLICT DO NOTHING`, [
      guru(i),
    ]);
  }

  for (const i of deret(JUMLAH_SISWA)) {
    await pool.query(
      `INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ($1, $2, $3, 'siswa', 'x') ON CONFLICT DO NOTHING`,
      [siswa(i), `b7-${String(2027000 + i)}`, `Siswa Uji B7 ${String(i).padStart(2, "0")}`],
    );
    await pool.query(`INSERT INTO siswa (pengguna_ref) VALUES ($1) ON CONFLICT DO NOTHING`, [
      siswa(i),
    ]);
  }

  // `aktif = false` pada keduanya. Periode uji TIDAK boleh menjadi periode aktif
  // sistem — I-03 hanya mengizinkan satu semester aktif per tahun ajaran, dan
  // data uji tidak berhak memakainya.
  await pool.query(
    `INSERT INTO tahun_ajaran (id, nama, tgl_mulai, tgl_selesai, aktif)
     VALUES ($1, 'b7-2027/2028 UJI', '2027-07-01', '2028-06-30', false)
     ON CONFLICT DO NOTHING`,
    [TAHUN],
  );
  await pool.query(
    `INSERT INTO periode (id, tahun_ajaran_ref, semester, tgl_mulai, tgl_selesai, aktif)
     VALUES ($1, $2, 'ganjil', '2027-07-01', '2027-12-31', false)
     ON CONFLICT DO NOTHING`,
    [PERIODE, TAHUN],
  );
  await pool.query(
    `INSERT INTO kelas (id, periode_ref, nama, tingkat, wali_kelas_ref)
     VALUES ($1, $2, 'b7-XII-UJI', $3, $4) ON CONFLICT DO NOTHING`,
    [KELAS, PERIODE, TINGKAT, WALI],
  );

  for (const i of deret(JUMLAH_SISWA)) {
    await pool.query(
      `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [KELAS, siswa(i), PERIODE],
    );
  }

  for (const i of deret(JUMLAH_MAPEL)) {
    await pool.query(
      `INSERT INTO mapel (id, kode, nama, tingkat, kkm, guru_ref)
       VALUES ($1, $2, $3, $4, 75, $5) ON CONFLICT DO NOTHING`,
      [
        mapel(i),
        `b7-M${String(i).padStart(2, "0")}`,
        `Mata Pelajaran Uji B7 ${i}`,
        TINGKAT,
        guru(i),
      ],
    );
    await pool.query(
      `INSERT INTO penugasan (id, guru_ref, mapel_ref, kelas_ref, tingkat)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [penugasan(i), guru(i), mapel(i), KELAS, TINGKAT],
    );
    await pool.query(
      `INSERT INTO penugasan_komponen (penugasan_ref, komponen_ref)
       SELECT $1, k.id FROM komponen_penilaian k ON CONFLICT DO NOTHING`,
      [penugasan(i)],
    );
  }

  // Seluruh sel sekaligus: 10 penugasan x 8 komponen x 30 siswa = 2.400 baris.
  // Nilainya beragam supaya rata-rata berbobot tidak kebetulan bulat, sehingga
  // berkas rapor yang dirender memuat angka yang bentuknya wajar.
  const { rowCount } = await pool.query(
    `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
     SELECT pk.penugasan_ref, pk.komponen_ref, ks.siswa_ref,
            70 + ((abs(hashtext(pk.komponen_ref::text || ks.siswa_ref::text)) % 250) / 10.0),
            $2
     FROM penugasan_komponen pk
     JOIN penugasan p ON p.id = pk.penugasan_ref
     JOIN kelas_siswa ks ON ks.kelas_ref = p.kelas_ref
     WHERE p.kelas_ref = $1
     ON CONFLICT DO NOTHING`,
    [KELAS, ADMIN],
  );

  // Rapor dikembalikan ke draft dengan menghapus lalu menyisipkan — I-21
  // melarang status mundur, dan pemicunya tidak pernah dimatikan.
  await pool.query(
    `DELETE FROM rapor_mapel WHERE rapor_ref IN (SELECT id FROM rapor WHERE kelas_ref = $1)`,
    [KELAS],
  );
  await pool.query(`DELETE FROM rapor WHERE kelas_ref = $1`, [KELAS]);
  await pool.query(
    `INSERT INTO rapor (siswa_ref, kelas_ref, periode_ref)
     SELECT siswa_ref, $1, $2 FROM kelas_siswa WHERE kelas_ref = $1`,
    [KELAS, PERIODE],
  );

  await pool.query("COMMIT");

  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM nilai n
     JOIN penugasan p ON p.id = n.penugasan_ref WHERE p.kelas_ref = $1`,
    [KELAS],
  );

  console.log(`kelas_ref        ${KELAS}`);
  console.log(`siswa            ${JUMLAH_SISWA}`);
  console.log(`mata pelajaran   ${JUMLAH_MAPEL}`);
  console.log(`nilai tersimpan  ${rows[0]?.n} (disisipkan kali ini: ${rowCount})`);
  console.log(`wali kelas       b7-wali`);
} catch (galat) {
  await pool.query("ROLLBACK").catch(() => undefined);
  console.error(`Benih gagal: ${galat instanceof Error ? galat.message : String(galat)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
