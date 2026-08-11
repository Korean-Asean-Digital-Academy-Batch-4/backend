import { poolPemilik } from "./bantuan.js";

/**
 * Fixture A7 — rapor.
 *
 * Menyiapkan satu kelas berisi dua siswa, **dua** mata pelajaran beserta
 * penugasannya, dan Wali Kelas yang bukan pengampu satu pun di antaranya. Dua
 * mata pelajaran diperlukan supaya pesan AC-07 dapat diuji dengan lebih dari
 * satu rincian, dan supaya "Wali Kelas melihat seluruh mata pelajaran tetapi
 * tidak dapat mengubah nilai Guru lain" (AC-09) benar-benar punya Guru lain.
 *
 * Baris `rapor` disisipkan berstatus `draft`, persis seperti yang dilakukan
 * pembuatan kelas pada A5 — bukan dibuat oleh tes rapor itu sendiri.
 */

export const A7 = {
  admin: "00000000-0000-4000-8000-000000000001",
  guruWali: "a7000000-0000-4000-8000-000000000011",
  guruSatu: "a7000000-0000-4000-8000-000000000012",
  guruDua: "a7000000-0000-4000-8000-000000000013",
  siswaSatu: "a7000000-0000-4000-8000-000000000021",
  siswaDua: "a7000000-0000-4000-8000-000000000022",
  siswaLuar: "a7000000-0000-4000-8000-000000000023",
  tahunAjaran: "a7000000-0000-4000-8000-000000000031",
  periode: "a7000000-0000-4000-8000-000000000041",
  kelas: "a7000000-0000-4000-8000-000000000051",
  kelasKosong: "a7000000-0000-4000-8000-000000000052",
  mapelSatu: "a7000000-0000-4000-8000-000000000061",
  mapelDua: "a7000000-0000-4000-8000-000000000062",
  penugasanSatu: "a7000000-0000-4000-8000-000000000071",
  penugasanDua: "a7000000-0000-4000-8000-000000000072",
} as const;

export const SISWA_KELAS = [A7.siswaSatu, A7.siswaDua] as const;
export const PENUGASAN_KELAS = [A7.penugasanSatu, A7.penugasanDua] as const;

/** Nama mata pelajaran fixture, dipakai memeriksa teks AC-07 kata demi kata. */
export const NAMA_MAPEL = { satu: "Aljabar A7", dua: "Botani A7" } as const;

let pernahDipasang = false;

export async function pasangFixtureA7(): Promise<void> {
  if (pernahDipasang) return;
  await dalamTransaksi(async (klien) => {
    await klien.query(
      `INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash) VALUES
        ('${A7.guruWali}',  'a7-guru-wali', 'Wali Kelas A7',  'guru',  'x'),
        ('${A7.guruSatu}',  'a7-guru-satu', 'Guru Satu A7',   'guru',  'x'),
        ('${A7.guruDua}',   'a7-guru-dua',  'Guru Dua A7',    'guru',  'x'),
        ('${A7.siswaSatu}', 'a7-2027001',   'Ani Sutarno',    'siswa', 'x'),
        ('${A7.siswaDua}',  'a7-2027002',   'Bayu Nugraha',   'siswa', 'x'),
        ('${A7.siswaLuar}', 'a7-2027003',   'Citra Larasati', 'siswa', 'x')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO guru (pengguna_ref) VALUES
        ('${A7.guruWali}'), ('${A7.guruSatu}'), ('${A7.guruDua}') ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO siswa (pengguna_ref) VALUES
        ('${A7.siswaSatu}'), ('${A7.siswaDua}'), ('${A7.siswaLuar}') ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO tahun_ajaran (id, nama, tgl_mulai, tgl_selesai, aktif) VALUES
        ('${A7.tahunAjaran}', 'a7-2027/2028', '2027-07-01', '2028-06-30', false)
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO periode (id, tahun_ajaran_ref, semester, tgl_mulai, tgl_selesai, aktif) VALUES
        ('${A7.periode}', '${A7.tahunAjaran}', 'ganjil', '2027-07-01', '2027-12-31', false)
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      // `kelasKosong` sengaja tanpa wali: `uq_kelas_wali_per_periode` hanya
      // mengizinkan satu kelas per Guru per periode (S-02), sehingga kelas kedua
      // ini diuji lewat Administrator.
      `INSERT INTO kelas (id, periode_ref, nama, tingkat, wali_kelas_ref) VALUES
        ('${A7.kelas}',       '${A7.periode}', 'a7-XII-1', 'XII', '${A7.guruWali}'),
        ('${A7.kelasKosong}', '${A7.periode}', 'a7-XII-2', 'XII', NULL)`,
    );
    await klien.query(
      `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES
        ('${A7.kelas}', '${A7.siswaSatu}', '${A7.periode}'),
        ('${A7.kelas}', '${A7.siswaDua}',  '${A7.periode}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO mapel (id, kode, nama, tingkat, guru_ref) VALUES
        ('${A7.mapelSatu}', 'a7-ALJ', '${NAMA_MAPEL.satu}', 'XII', '${A7.guruSatu}'),
        ('${A7.mapelDua}',  'a7-BOT', '${NAMA_MAPEL.dua}',  'XII', '${A7.guruDua}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO penugasan (id, guru_ref, mapel_ref, kelas_ref, tingkat) VALUES
        ('${A7.penugasanSatu}', '${A7.guruSatu}', '${A7.mapelSatu}', '${A7.kelas}', 'XII'),
        ('${A7.penugasanDua}',  '${A7.guruDua}',  '${A7.mapelDua}',  '${A7.kelas}', 'XII')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO penugasan_komponen (penugasan_ref, komponen_ref)
       SELECT p.id, k.id
       FROM (VALUES ('${A7.penugasanSatu}'::uuid), ('${A7.penugasanDua}'::uuid)) AS p(id)
       CROSS JOIN komponen_penilaian k
       ON CONFLICT DO NOTHING`,
    );
  });
  pernahDipasang = true;
}

/**
 * Mengembalikan kelas ke keadaan awal: tanpa nilai, tanpa presensi, dan seluruh
 * rapor kembali `draft`.
 *
 * I-21 melarang UPDATE mundur, sehingga jalur kembali satu-satunya adalah
 * menghapus baris lalu menyisipkan ulang draft — invarian tidak pernah dimatikan
 * demi kenyamanan fixture.
 */
export async function bersihkanA7(): Promise<void> {
  await dalamTransaksi(async (klien) => {
    await klien.query(
      `DELETE FROM nilai WHERE penugasan_ref IN ('${A7.penugasanSatu}', '${A7.penugasanDua}')`,
    );
    await klien.query(
      `DELETE FROM presensi WHERE sesi_ref IN (
         SELECT id FROM sesi WHERE penugasan_ref IN ('${A7.penugasanSatu}', '${A7.penugasanDua}'))`,
    );
    await klien.query(
      `DELETE FROM sesi WHERE penugasan_ref IN ('${A7.penugasanSatu}', '${A7.penugasanDua}')`,
    );
    await klien.query(
      `DELETE FROM rapor_mapel WHERE rapor_ref IN (
         SELECT id FROM rapor WHERE periode_ref = '${A7.periode}')`,
    );
    await klien.query(`DELETE FROM rapor WHERE periode_ref = '${A7.periode}'`);
    await klien.query(
      `INSERT INTO rapor (siswa_ref, kelas_ref, periode_ref) VALUES
        ('${A7.siswaSatu}', '${A7.kelas}', '${A7.periode}'),
        ('${A7.siswaDua}',  '${A7.kelas}', '${A7.periode}')`,
    );
  });
}

export async function hapusFixtureA7(): Promise<void> {
  await dalamTransaksi(async (klien) => {
    await klien.query(
      `DELETE FROM nilai WHERE penugasan_ref IN ('${A7.penugasanSatu}', '${A7.penugasanDua}')`,
    );
    await klien.query(
      `DELETE FROM presensi WHERE sesi_ref IN (
         SELECT id FROM sesi WHERE penugasan_ref IN ('${A7.penugasanSatu}', '${A7.penugasanDua}'))`,
    );
    await klien.query(
      `DELETE FROM sesi WHERE penugasan_ref IN ('${A7.penugasanSatu}', '${A7.penugasanDua}')`,
    );
    await klien.query(
      `DELETE FROM rapor_mapel WHERE rapor_ref IN (
         SELECT id FROM rapor WHERE periode_ref = '${A7.periode}')`,
    );
    await klien.query(`DELETE FROM rapor WHERE periode_ref = '${A7.periode}'`);
    await klien.query(
      `DELETE FROM penugasan_komponen WHERE penugasan_ref IN ('${A7.penugasanSatu}', '${A7.penugasanDua}')`,
    );
    await klien.query(
      `DELETE FROM penugasan WHERE id IN ('${A7.penugasanSatu}', '${A7.penugasanDua}')`,
    );
    await klien.query(
      `DELETE FROM kelas_siswa WHERE kelas_ref IN ('${A7.kelas}', '${A7.kelasKosong}')`,
    );
    await klien.query(`DELETE FROM kelas WHERE id IN ('${A7.kelas}', '${A7.kelasKosong}')`);
    await klien.query(`DELETE FROM mapel WHERE id IN ('${A7.mapelSatu}', '${A7.mapelDua}')`);
    await klien.query(`DELETE FROM periode WHERE id = '${A7.periode}'`);
    await klien.query(`DELETE FROM tahun_ajaran WHERE id = '${A7.tahunAjaran}'`);
    await klien.query(
      `DELETE FROM guru WHERE pengguna_ref IN ('${A7.guruWali}', '${A7.guruSatu}', '${A7.guruDua}')`,
    );
    await klien.query(
      `DELETE FROM siswa WHERE pengguna_ref IN ('${A7.siswaSatu}', '${A7.siswaDua}', '${A7.siswaLuar}')`,
    );
    await klien.query(
      `DELETE FROM pengguna WHERE id IN (
        '${A7.guruWali}', '${A7.guruSatu}', '${A7.guruDua}',
        '${A7.siswaSatu}', '${A7.siswaDua}', '${A7.siswaLuar}')`,
    );
  });
  pernahDipasang = false;
}

/** Pengenal delapan komponen benih, terurut tampilan. */
export async function komponenA7(): Promise<readonly string[]> {
  const hasil = await poolPemilik().query<{ id: string }>(
    `SELECT id FROM komponen_penilaian ORDER BY urutan`,
  );
  return hasil.rows.map((baris) => baris.id);
}

/** Mengisi seluruh sel nilai satu penugasan bagi seluruh siswa kelas. */
export async function isiNilaiPenuh(penugasanRef: string, nilai = 80): Promise<void> {
  await poolPemilik().query(
    `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
     SELECT '${penugasanRef}', k.id, s.siswa_ref, ${nilai}, '${A7.admin}'
     FROM komponen_penilaian k
     CROSS JOIN (SELECT siswa_ref FROM kelas_siswa WHERE kelas_ref = '${A7.kelas}') s
     ON CONFLICT ON CONSTRAINT uq_nilai DO UPDATE SET nilai = EXCLUDED.nilai`,
  );
}

/** Mengisi seluruh sel nilai kedua penugasan — kelas siap difinalisasi. */
export async function isiSeluruhNilai(nilai = 80): Promise<void> {
  for (const penugasanRef of PENUGASAN_KELAS) {
    await isiNilaiPenuh(penugasanRef, nilai);
  }
}

/**
 * Membuka sejumlah sesi beserta presensinya.
 *
 * `status` diberikan per sesi dan berlaku bagi `siswaRef`; siswa kelas lainnya
 * dicatat hadir, mengikuti bentuk sesi sungguhan yang selalu memuat seluruh
 * siswa kelas (I-15).
 */
export async function bukaSesiPresensi(
  penugasanRef: string,
  status: readonly string[],
  siswaRef: string,
): Promise<void> {
  const pool = poolPemilik();
  for (const [urutan, satu] of status.entries()) {
    const tanggal = `2027-09-${String(urutan + 1).padStart(2, "0")}`;
    const sesi = await pool.query<{ id: string }>(
      `INSERT INTO sesi (penugasan_ref, tanggal, dibuka_oleh)
       VALUES ($1, $2, '${A7.admin}') RETURNING id`,
      [penugasanRef, tanggal],
    );
    const sesiId = sesi.rows[0]!.id;
    await pool.query(
      `INSERT INTO presensi (sesi_ref, siswa_ref, status, diperbarui_oleh)
       SELECT $1, ks.siswa_ref,
              CASE WHEN ks.siswa_ref = $2 THEN $3 ELSE 'hadir' END,
              '${A7.admin}'
       FROM kelas_siswa ks WHERE ks.kelas_ref = '${A7.kelas}'`,
      [sesiId, siswaRef, satu],
    );
  }
}

async function dalamTransaksi(jalan: (klien: import("pg").PoolClient) => Promise<void>) {
  const klien = await poolPemilik().connect();
  try {
    await klien.query("BEGIN");
    await jalan(klien);
    await klien.query("COMMIT");
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
}
