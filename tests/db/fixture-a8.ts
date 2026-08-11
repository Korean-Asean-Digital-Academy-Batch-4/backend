import { poolPemilik } from "./bantuan.js";

/**
 * Fixture A8 — jalur AI.
 *
 * Berbeda dari fixture A7 dalam satu hal yang menentukan: **periodenya aktif**.
 * Tombol Suggestion membaca semester berjalan, sehingga tanpa periode aktif
 * tidak ada yang dapat dibaca. Tahun ajarannya tersendiri, sehingga
 * `uq_periode_aktif_per_tahun` tidak bertabrakan dengan benih maupun A7.
 *
 * Dua siswa: satu bernilai lengkap, satu **tanpa satu pun nilai** — yang kedua
 * membuktikan CK-API-19, yaitu data kosong dijawab tanpa memanggil AI.
 */

export const A8 = {
  admin: "00000000-0000-4000-8000-000000000001",
  guru: "a8000000-0000-4000-8000-000000000011",
  siswaBernilai: "a8000000-0000-4000-8000-000000000021",
  siswaKosong: "a8000000-0000-4000-8000-000000000022",
  tahunAjaran: "a8000000-0000-4000-8000-000000000031",
  periode: "a8000000-0000-4000-8000-000000000041",
  kelas: "a8000000-0000-4000-8000-000000000051",
  mapel: "a8000000-0000-4000-8000-000000000061",
  penugasan: "a8000000-0000-4000-8000-000000000071",
} as const;

export const NAMA_MAPEL_A8 = "Aljabar A8";

let pernahDipasang = false;

export async function pasangFixtureA8(): Promise<void> {
  if (pernahDipasang) return;
  await dalamTransaksi(async (klien) => {
    await klien.query(
      `INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash) VALUES
        ('${A8.guru}',          'a8-guru',    'Guru A8',       'guru',  'x'),
        ('${A8.siswaBernilai}', 'a8-2028001', 'Dewi Anggraini', 'siswa', 'x'),
        ('${A8.siswaKosong}',   'a8-2028002', 'Eko Saputra',    'siswa', 'x')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO guru (pengguna_ref) VALUES ('${A8.guru}') ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO siswa (pengguna_ref) VALUES ('${A8.siswaBernilai}'), ('${A8.siswaKosong}')
       ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO tahun_ajaran (id, nama, tgl_mulai, tgl_selesai, aktif) VALUES
        ('${A8.tahunAjaran}', 'a8-2028/2029', '2028-07-01', '2029-06-30', false)
      ON CONFLICT DO NOTHING`,
    );
    // aktif = true: inilah yang membedakannya dari fixture A7.
    await klien.query(
      `INSERT INTO periode (id, tahun_ajaran_ref, semester, tgl_mulai, tgl_selesai, aktif) VALUES
        ('${A8.periode}', '${A8.tahunAjaran}', 'ganjil', '2028-07-01', '2028-12-31', true)
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO kelas (id, periode_ref, nama, tingkat, wali_kelas_ref) VALUES
        ('${A8.kelas}', '${A8.periode}', 'a8-XI-1', 'XI', NULL)`,
    );
    await klien.query(
      `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES
        ('${A8.kelas}', '${A8.siswaBernilai}', '${A8.periode}'),
        ('${A8.kelas}', '${A8.siswaKosong}',   '${A8.periode}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO mapel (id, kode, nama, tingkat, guru_ref) VALUES
        ('${A8.mapel}', 'a8-ALJ', '${NAMA_MAPEL_A8}', 'XI', '${A8.guru}')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO penugasan (id, guru_ref, mapel_ref, kelas_ref, tingkat) VALUES
        ('${A8.penugasan}', '${A8.guru}', '${A8.mapel}', '${A8.kelas}', 'XI')
      ON CONFLICT DO NOTHING`,
    );
    await klien.query(
      `INSERT INTO penugasan_komponen (penugasan_ref, komponen_ref)
       SELECT '${A8.penugasan}', id FROM komponen_penilaian ON CONFLICT DO NOTHING`,
    );
  });
  pernahDipasang = true;
}

/** Mengisi seluruh komponen bagi satu siswa saja — yang lain tetap kosong. */
export async function isiNilaiSiswa(siswaRef: string, nilai = 80): Promise<void> {
  await poolPemilik().query(
    `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
     SELECT '${A8.penugasan}', id, $1, $2, '${A8.admin}' FROM komponen_penilaian
     ON CONFLICT ON CONSTRAINT uq_nilai DO UPDATE SET nilai = EXCLUDED.nilai`,
    [siswaRef, nilai],
  );
}

/** Satu sesi presensi beserta statusnya bagi siswa yang disebut. */
export async function bukaSesiA8(tanggal: string, status: string, siswaRef: string): Promise<void> {
  const sesi = await poolPemilik().query<{ id: string }>(
    `INSERT INTO sesi (penugasan_ref, tanggal, dibuka_oleh)
     VALUES ('${A8.penugasan}', $1, '${A8.admin}') RETURNING id`,
    [tanggal],
  );
  await poolPemilik().query(
    `INSERT INTO presensi (sesi_ref, siswa_ref, status, diperbarui_oleh)
     SELECT $1, ks.siswa_ref, CASE WHEN ks.siswa_ref = $2 THEN $3 ELSE 'hadir' END, '${A8.admin}'
     FROM kelas_siswa ks WHERE ks.kelas_ref = '${A8.kelas}'`,
    [sesi.rows[0]!.id, siswaRef, status],
  );
}

export async function bersihkanA8(): Promise<void> {
  await dalamTransaksi(async (klien) => {
    await klien.query(`DELETE FROM nilai WHERE penugasan_ref = '${A8.penugasan}'`);
    await klien.query(
      `DELETE FROM presensi WHERE sesi_ref IN (SELECT id FROM sesi WHERE penugasan_ref = '${A8.penugasan}')`,
    );
    await klien.query(`DELETE FROM sesi WHERE penugasan_ref = '${A8.penugasan}'`);
    await klien.query(`DELETE FROM pembatas_laju WHERE kunci LIKE 'suggestion:%'`);
  });
}

export async function hapusFixtureA8(): Promise<void> {
  await dalamTransaksi(async (klien) => {
    await klien.query(`DELETE FROM nilai WHERE penugasan_ref = '${A8.penugasan}'`);
    await klien.query(
      `DELETE FROM presensi WHERE sesi_ref IN (SELECT id FROM sesi WHERE penugasan_ref = '${A8.penugasan}')`,
    );
    await klien.query(`DELETE FROM sesi WHERE penugasan_ref = '${A8.penugasan}'`);
    await klien.query(`DELETE FROM pembatas_laju WHERE kunci LIKE 'suggestion:%'`);
    await klien.query(`DELETE FROM penugasan_komponen WHERE penugasan_ref = '${A8.penugasan}'`);
    await klien.query(`DELETE FROM penugasan WHERE id = '${A8.penugasan}'`);
    await klien.query(`DELETE FROM kelas_siswa WHERE kelas_ref = '${A8.kelas}'`);
    await klien.query(`DELETE FROM kelas WHERE id = '${A8.kelas}'`);
    await klien.query(`DELETE FROM mapel WHERE id = '${A8.mapel}'`);
    await klien.query(`DELETE FROM periode WHERE id = '${A8.periode}'`);
    await klien.query(`DELETE FROM tahun_ajaran WHERE id = '${A8.tahunAjaran}'`);
    await klien.query(`DELETE FROM guru WHERE pengguna_ref = '${A8.guru}'`);
    await klien.query(
      `DELETE FROM siswa WHERE pengguna_ref IN ('${A8.siswaBernilai}', '${A8.siswaKosong}')`,
    );
    await klien.query(
      `DELETE FROM pengguna WHERE id IN ('${A8.guru}', '${A8.siswaBernilai}', '${A8.siswaKosong}')`,
    );
  });
  pernahDipasang = false;
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
