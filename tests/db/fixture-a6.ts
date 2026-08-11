import { poolPemilik } from "./bantuan.js";

/**
 * Fixture A6 — nilai dan presensi.
 *
 * Menyiapkan satu kelas berisi tiga siswa, satu guru pengampu, satu guru asing,
 * dan satu penugasan beserta snapshot delapan komponen. Seluruh pengenal
 * dipatok supaya tes menyebut baris yang sama tanpa saling mewariskan keadaan
 * lewat urutan berjalan.
 */

export const A6 = {
  admin: "00000000-0000-4000-8000-000000000001",
  guruPengampu: "a6000000-0000-4000-8000-000000000011",
  guruAsing: "a6000000-0000-4000-8000-000000000012",
  // Wali Kelas terpisah dari guru pengampu — untuk menguji bahwa Wali Kelas
  // tidak dapat membuka/mengubah sesi Guru lain (aktor-role.md §7).
  guruWali: "a6000000-0000-4000-8000-000000000013",
  siswa1: "a6000000-0000-4000-8000-000000000021",
  siswa2: "a6000000-0000-4000-8000-000000000022",
  siswa3: "a6000000-0000-4000-8000-000000000023",
  siswaAsing: "a6000000-0000-4000-8000-000000000024",
  tahunAjaran: "a6000000-0000-4000-8000-000000000031",
  periode: "a6000000-0000-4000-8000-000000000041",
  kelas: "a6000000-0000-4000-8000-000000000051",
  mapel: "a6000000-0000-4000-8000-000000000061",
  penugasan: "a6000000-0000-4000-8000-000000000071",
  // UUID sah tetapi tidak pernah terdaftar pada snapshot — komponen asing.
  komponenAsing: "a6000000-0000-4000-8000-000000000082",
} as const;

let pernahDipasang = false;

/** Memasang fixture satu kali; panggilan berikutnya tidak menulis ulang. */
export async function pasangFixtureA6(): Promise<void> {
  if (pernahDipasang) return;
  const pool = poolPemilik();
  const klien = await pool.connect();
  try {
    await klien.query("BEGIN");
    await klien.query(
      `INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash) VALUES
        ('${A6.guruPengampu}', 'a6-guru-pengampu', 'Guru Pengampu A6', 'guru', 'x'),
        ('${A6.guruAsing}',    'a6-guru-asing',    'Guru Asing A6',    'guru', 'x'),
        ('${A6.guruWali}',     'a6-guru-wali',     'Guru Wali A6',     'guru', 'x'),
        ('${A6.siswa1}',       'a6-siswa-1',       'Siswa Satu',       'siswa', 'x'),
        ('${A6.siswa2}',       'a6-siswa-2',       'Siswa Dua',        'siswa', 'x'),
        ('${A6.siswa3}',       'a6-siswa-3',       'Siswa Tiga',       'siswa', 'x'),
        ('${A6.siswaAsing}',   'a6-siswa-asing',   'Siswa Asing',      'siswa', 'x')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO guru (pengguna_ref) VALUES ('${A6.guruPengampu}'), ('${A6.guruAsing}'), ('${A6.guruWali}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO siswa (pengguna_ref) VALUES
        ('${A6.siswa1}'), ('${A6.siswa2}'), ('${A6.siswa3}'), ('${A6.siswaAsing}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO tahun_ajaran (id, nama, tgl_mulai, tgl_selesai, aktif) VALUES
        ('${A6.tahunAjaran}', 'a6-2026/2027', '2026-07-01', '2027-06-30', true)
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO periode (id, tahun_ajaran_ref, semester, tgl_mulai, tgl_selesai, aktif) VALUES
        ('${A6.periode}', '${A6.tahunAjaran}', 'ganjil', '2026-07-01', '2026-12-31', true)
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO kelas (id, periode_ref, nama, tingkat, wali_kelas_ref) VALUES
        ('${A6.kelas}', '${A6.periode}', 'a6-X-1', 'X', '${A6.guruWali}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES
        ('${A6.kelas}', '${A6.siswa1}', '${A6.periode}'),
        ('${A6.kelas}', '${A6.siswa2}', '${A6.periode}'),
        ('${A6.kelas}', '${A6.siswa3}', '${A6.periode}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO mapel (id, kode, nama, tingkat, guru_ref) VALUES
        ('${A6.mapel}', 'a6-BIO', 'Biologi A6', 'X', '${A6.guruPengampu}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO penugasan (id, guru_ref, mapel_ref, kelas_ref, tingkat) VALUES
        ('${A6.penugasan}', '${A6.guruPengampu}', '${A6.mapel}', '${A6.kelas}', 'X')
      ON CONFLICT DO NOTHING`,
    );
    // Snapshot komponen dipasang di sini DAN dipulihkan bersihkanPencatatanA6
    // pada setiap giliran. Ia memakai delapan komponen benih (I-10 membatasi
    // jumlah bobot SELURUH tabel = 100, sehingga komponen kedua mana pun
    // mustahil berdiri); rantai FK-nya terhadap komponen benih ditangani tes
    // invarian I-10 dengan melepasnya sementara di dalam transaksi batal.
    await klien.query(
      `INSERT INTO penugasan_komponen (penugasan_ref, komponen_ref)
       SELECT '${A6.penugasan}', id FROM komponen_penilaian
       ON CONFLICT DO NOTHING`,
    );
    await klien.query("COMMIT");
    pernahDipasang = true;
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
}

/**
 * Mengembalikan keadaan pencatatan ke awal: menghapus nilai, presensi, sesi,
 * dan rapor kelas fixture, lalu memasang ulang snapshot komponen dari templat
 * benih — satu transaksi, sehingga pengujian yang terganggu di tengah tidak
 * meninggalkan keadaan separuh. FK RESTRICT pada penugasan_komponen
 * diloloskan oleh penghapusan menyeluruh yang langsung disisipkan ulang.
 */
export async function bersihkanPencatatanA6(): Promise<void> {
  const pool = poolPemilik();
  const klien = await pool.connect();
  try {
    await klien.query("BEGIN");
    await klien.query(`DELETE FROM nilai WHERE penugasan_ref = '${A6.penugasan}'`);
    await klien.query(
      `DELETE FROM presensi WHERE sesi_ref IN (SELECT id FROM sesi WHERE penugasan_ref = '${A6.penugasan}')`,
    );
    await klien.query(`DELETE FROM sesi WHERE penugasan_ref = '${A6.penugasan}'`);
    await klien.query(
      `DELETE FROM rapor WHERE kelas_ref = '${A6.kelas}' AND periode_ref = '${A6.periode}'`,
    );
    await klien.query(
      `DELETE FROM penugasan_komponen WHERE penugasan_ref = '${A6.penugasan}'`,
    );
    await klien.query(
      `INSERT INTO penugasan_komponen (penugasan_ref, komponen_ref)
       SELECT '${A6.penugasan}', id FROM komponen_penilaian`,
    );
    await klien.query("COMMIT");
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
}

/**
 * Melepas seluruh data induk fixture agar berkas tes lain tidak melihat kelas
 * A6 pada endpoint daftar global. File tes DB berjalan berurutan tetapi berbagi
 * satu basis data, jadi pembersihan pencatatan saja tidak cukup untuk isolasi.
 */
export async function hapusFixtureA6(): Promise<void> {
  const pool = poolPemilik();
  const klien = await pool.connect();
  try {
    await klien.query("BEGIN");
    await klien.query(`DELETE FROM nilai WHERE penugasan_ref = '${A6.penugasan}'`);
    await klien.query(
      `DELETE FROM presensi WHERE sesi_ref IN (SELECT id FROM sesi WHERE penugasan_ref = '${A6.penugasan}')`,
    );
    await klien.query(`DELETE FROM sesi WHERE penugasan_ref = '${A6.penugasan}'`);
    await klien.query(
      `DELETE FROM rapor WHERE kelas_ref = '${A6.kelas}' AND periode_ref = '${A6.periode}'`,
    );
    await klien.query(
      `DELETE FROM penugasan_komponen WHERE penugasan_ref = '${A6.penugasan}'`,
    );
    await klien.query(`DELETE FROM penugasan WHERE id = '${A6.penugasan}'`);
    await klien.query(`DELETE FROM kelas_siswa WHERE kelas_ref = '${A6.kelas}'`);
    await klien.query(`DELETE FROM kelas WHERE id = '${A6.kelas}'`);
    await klien.query(`DELETE FROM mapel WHERE id = '${A6.mapel}'`);
    await klien.query(`DELETE FROM periode WHERE id = '${A6.periode}'`);
    await klien.query(`DELETE FROM tahun_ajaran WHERE id = '${A6.tahunAjaran}'`);
    await klien.query(
      `DELETE FROM guru WHERE pengguna_ref IN ('${A6.guruPengampu}', '${A6.guruAsing}', '${A6.guruWali}')`,
    );
    await klien.query(
      `DELETE FROM siswa WHERE pengguna_ref IN ('${A6.siswa1}', '${A6.siswa2}', '${A6.siswa3}', '${A6.siswaAsing}')`,
    );
    await klien.query(
      `DELETE FROM pengguna WHERE id IN (
        '${A6.guruPengampu}', '${A6.guruAsing}', '${A6.guruWali}',
        '${A6.siswa1}', '${A6.siswa2}', '${A6.siswa3}', '${A6.siswaAsing}'
      )`,
    );
    await klien.query("COMMIT");
    pernahDipasang = false;
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
}

/**
 * Menandai rapor kelas fixture sebagai finalized — untuk pengujian I-22.
 *
 * Baris rapor tidak dibuat fixture; ia disisipkan di sini langsung berstatus
 * finalized (bukan UPDATE draft→final) supaya seluruh siklus hidupnya patuh
 * pada `trg_rapor_status_maju` — invarian I-21 tidak pernah dimatikan, bahkan
 * oleh fixture.
 */
export async function finalisasiRaporA6(): Promise<void> {
  await poolPemilik().query(
    `INSERT INTO rapor (siswa_ref, kelas_ref, periode_ref, status, difinalisasi_oleh, difinalisasi_pada)
     SELECT s, '${A6.kelas}', '${A6.periode}', 'finalized', '${A6.guruPengampu}', now()
     FROM (VALUES ('${A6.siswa1}'::uuid), ('${A6.siswa2}'::uuid), ('${A6.siswa3}'::uuid)) AS v(s)
     ON CONFLICT ON CONSTRAINT uq_rapor_siswa_periode DO UPDATE
       SET status = 'finalized', difinalisasi_oleh = '${A6.guruPengampu}', difinalisasi_pada = now()
       WHERE rapor.status = 'draft'`,
  );
}

/**
 * Mengembalikan keadaan rapor ke "belum final". I-21 melarang UPDATE mundur,
 * sehingga jalur kembali satu-satunya adalah menghapus baris lalu
 * menyisipkan ulang draft — persis seperti yang akan dilakukan prosedur
 * pembatalan finalisasi sungguhan.
 */
export async function kembalikanRaporDraftA6(): Promise<void> {
  const pool = poolPemilik();
  const klien = await pool.connect();
  try {
    await klien.query("BEGIN");
    await klien.query(
      `DELETE FROM rapor WHERE kelas_ref = '${A6.kelas}' AND periode_ref = '${A6.periode}'`,
    );
    await klien.query(
      `INSERT INTO rapor (siswa_ref, kelas_ref, periode_ref) VALUES
        ('${A6.siswa1}', '${A6.kelas}', '${A6.periode}'),
        ('${A6.siswa2}', '${A6.kelas}', '${A6.periode}'),
        ('${A6.siswa3}', '${A6.kelas}', '${A6.periode}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query("COMMIT");
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
}

/** Pengenal komponen snapshot pertama penugasan fixture — untuk payload nilai. */
export async function komponenSnapshotA6(): Promise<readonly string[]> {
  const hasil = await poolPemilik().query<{ komponen_ref: string }>(
    `SELECT komponen_ref FROM penugasan_komponen
     WHERE penugasan_ref = '${A6.penugasan}'
     ORDER BY komponen_ref`,
  );
  return hasil.rows.map((r) => r.komponen_ref);
}
