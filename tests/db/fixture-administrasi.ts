import writeXlsxFile from "write-excel-file/node";

import { poolPemilik } from "./bantuan.js";

export type BarisFixtureAkun = Readonly<{ nama: string; namaPengguna: string }>;
export type BarisFixtureSiswa = Readonly<{ kelas: string; nis: string; nama: string }>;
export type TabelPemicuGagal =
  "sesi_masuk" | "periode" | "kelas_siswa" | "penugasan" | "penugasan_komponen" | "rapor";

type KomponenAwal = Readonly<{
  id: string;
  kode: string;
  nama: string;
  bobot: number;
  urutan: number;
}>;

let komponenAwal: readonly KomponenAwal[] | undefined;

export function csvAkun(peran: "guru" | "siswa", baris: readonly BarisFixtureAkun[]): Buffer {
  const identitas = peran === "guru" ? "NIP" : "NIS";
  return Buffer.from(
    [["Nama", identitas], ...baris.map((item) => [item.nama, item.namaPengguna])]
      .map((item) => item.map(kutipCsv).join(","))
      .join("\n") + "\n",
    "utf8",
  );
}

export function xlsxSiswa(baris: readonly BarisFixtureSiswa[]): Promise<Buffer> {
  return writeXlsxFile([
    ["Kelas", "NIS", "Nama"],
    ...baris.map((item) => [item.kelas, item.nis, item.nama]),
  ]).toBuffer();
}

export async function bersihkanDataAdministrasi(): Promise<void> {
  const pool = poolPemilik();
  await hapusPemicuUji();
  const klien = await pool.connect();
  try {
    await klien.query("BEGIN");
    await klien.query(`DELETE FROM pembatas_laju WHERE kunci LIKE 'unggah:%'`);
    await klien.query(`DELETE FROM sesi_masuk WHERE pengguna_ref IN (
      SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'
    )`);
    await klien.query(`DELETE FROM rapor_mapel WHERE rapor_ref IN (
      SELECT id FROM rapor WHERE kelas_ref IN (SELECT id FROM kelas WHERE nama LIKE 'uji-a5-%')
    )`);
    await klien.query(`DELETE FROM rapor WHERE kelas_ref IN (
      SELECT id FROM kelas WHERE nama LIKE 'uji-a5-%'
    )`);
    await klien.query(`DELETE FROM presensi WHERE siswa_ref IN (
      SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'
    ) OR diperbarui_oleh IN (
      SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'
    ) OR sesi_ref IN (
      SELECT id FROM sesi WHERE penugasan_ref IN (
        SELECT id FROM penugasan WHERE kelas_ref IN (SELECT id FROM kelas WHERE nama LIKE 'uji-a5-%')
      )
    )`);
    await klien.query(`DELETE FROM sesi WHERE dibuka_oleh IN (
      SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'
    ) OR penugasan_ref IN (
      SELECT id FROM penugasan WHERE kelas_ref IN (SELECT id FROM kelas WHERE nama LIKE 'uji-a5-%')
    )`);
    await klien.query(`DELETE FROM nilai WHERE siswa_ref IN (
      SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'
    ) OR diperbarui_oleh IN (
      SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'
    ) OR penugasan_ref IN (
      SELECT id FROM penugasan WHERE kelas_ref IN (SELECT id FROM kelas WHERE nama LIKE 'uji-a5-%')
    )`);
    await klien.query(`DELETE FROM penugasan_komponen WHERE penugasan_ref IN (
      SELECT id FROM penugasan WHERE kelas_ref IN (SELECT id FROM kelas WHERE nama LIKE 'uji-a5-%')
    )`);
    await klien.query(`DELETE FROM penugasan WHERE kelas_ref IN (
      SELECT id FROM kelas WHERE nama LIKE 'uji-a5-%'
    )`);
    await klien.query(`DELETE FROM kelas_siswa WHERE kelas_ref IN (
      SELECT id FROM kelas WHERE nama LIKE 'uji-a5-%'
    ) OR siswa_ref IN (SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%')`);
    await klien.query(`DELETE FROM mapel WHERE kode LIKE 'uji-a5-%'`);
    await klien.query(`DELETE FROM kelas WHERE nama LIKE 'uji-a5-%'`);
    await klien.query(`DELETE FROM periode WHERE tahun_ajaran_ref IN (
      SELECT id FROM tahun_ajaran WHERE nama LIKE 'uji-a5-%'
    )`);
    await klien.query(`DELETE FROM tahun_ajaran WHERE nama LIKE 'uji-a5-%'`);
    await klien.query(`DELETE FROM guru WHERE pengguna_ref IN (
      SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'
    )`);
    await klien.query(`DELETE FROM siswa WHERE pengguna_ref IN (
      SELECT id FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'
    )`);
    await klien.query(`DELETE FROM pengguna WHERE nama_pengguna LIKE 'uji-a5-%'`);
    await klien.query("COMMIT");
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
}

export async function pasangPemicuGagal(tabel: TabelPemicuGagal): Promise<() => Promise<void>> {
  if (!TABEL_PEMICU.has(tabel)) throw new Error("Tabel pemicu uji tidak diizinkan.");
  const fungsi = `uji_a5_gagal_${tabel}`;
  const pemicu = `uji_a5_pemicu_${tabel}`;
  const pool = poolPemilik();
  await pool.query(`CREATE OR REPLACE FUNCTION ${fungsi}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'uji a5 fault injection'; END
  $$`);
  await pool.query(`CREATE TRIGGER ${pemicu} BEFORE INSERT OR UPDATE OR DELETE ON ${tabel}
    FOR EACH ROW EXECUTE FUNCTION ${fungsi}()`);
  return async () => {
    await pool.query(`DROP TRIGGER IF EXISTS ${pemicu} ON ${tabel}`);
    await pool.query(`DROP FUNCTION IF EXISTS ${fungsi}()`);
  };
}

export async function pasangPemicuGagalAktivasiPeriode(
  periodeRef: string,
): Promise<() => Promise<void>> {
  if (!/^[0-9a-f-]{36}$/i.test(periodeRef)) throw new Error("ID periode uji tidak sah.");
  const pool = poolPemilik();
  const kutipan = (
    await pool.query<{ nilai: string }>(`SELECT quote_literal($1) AS nilai`, [periodeRef])
  ).rows[0]?.nilai;
  if (!kutipan) throw new Error("ID periode uji tidak dapat dikutip.");
  await pool.query(`CREATE OR REPLACE FUNCTION uji_a5_gagal_aktivasi_periode()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id = ${kutipan}::uuid AND NEW.aktif THEN
        RAISE EXCEPTION 'uji a5 fault injection';
      END IF;
      RETURN NEW;
    END
  $$`);
  await pool.query(`CREATE TRIGGER uji_a5_pemicu_aktivasi_periode BEFORE UPDATE ON periode
    FOR EACH ROW EXECUTE FUNCTION uji_a5_gagal_aktivasi_periode()`);
  return async () => {
    await pool.query(`DROP TRIGGER IF EXISTS uji_a5_pemicu_aktivasi_periode ON periode`);
    await pool.query(`DROP FUNCTION IF EXISTS uji_a5_gagal_aktivasi_periode()`);
  };
}

export async function pulihkanKomponenAwal(): Promise<void> {
  const pool = poolPemilik();
  komponenAwal ??= Object.freeze(
    (
      await pool.query<KomponenAwal>(
        `SELECT id, kode, nama, bobot, urutan FROM komponen_penilaian ORDER BY urutan`,
      )
    ).rows.map((item) => Object.freeze({ ...item })),
  );
  if (komponenAwal.length !== 8) throw new Error("Fixture komponen awal tidak lengkap.");

  const klien = await pool.connect();
  try {
    await klien.query("BEGIN");
    await klien.query(`DELETE FROM penugasan_komponen`);
    await klien.query(`DELETE FROM komponen_penilaian`);
    for (const item of komponenAwal) {
      await klien.query(
        `INSERT INTO komponen_penilaian (id, kode, nama, bobot, urutan)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.id, item.kode, item.nama, item.bobot, item.urutan],
      );
    }
    await klien.query("COMMIT");
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
}

const TABEL_PEMICU = new Set<TabelPemicuGagal>([
  "sesi_masuk",
  "periode",
  "kelas_siswa",
  "penugasan",
  "penugasan_komponen",
  "rapor",
]);

async function hapusPemicuUji(): Promise<void> {
  const pool = poolPemilik();
  for (const tabel of TABEL_PEMICU) {
    await pool.query(`DROP TRIGGER IF EXISTS uji_a5_pemicu_${tabel} ON ${tabel}`);
    await pool.query(`DROP FUNCTION IF EXISTS uji_a5_gagal_${tabel}()`);
  }
  await pool.query(`DROP TRIGGER IF EXISTS uji_a5_pemicu_aktivasi_periode ON periode`);
  await pool.query(`DROP FUNCTION IF EXISTS uji_a5_gagal_aktivasi_periode()`);
}

function kutipCsv(nilai: string): string {
  return /[",\r\n]/.test(nilai) ? `"${nilai.replaceAll('"', '""')}"` : nilai;
}
