import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUji, JawabanUji } from "./bantuan-rute.js";
import { masukSebagai, nyalakanAppUji } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import { BENIH } from "./benih.js";
import {
  bersihkanDataAdministrasi,
  pasangPemicuGagal,
  pulihkanKomponenAwal,
  type BarisFixtureSiswa,
  type TabelPemicuGagal,
  xlsxSiswa,
} from "./fixture-administrasi.js";

const NAMA_KELAS_BERHASIL = "uji-a5-task8-X IPA 1";
const NAMA_KELAS_GAGAL = "uji-a5-task8-X IPA gagal";
const NAMA_KELAS_KONFLIK = "uji-a5-task8-X IPA konflik";
const NAMA_KELAS_RACE_A = "uji-a5-task8-race-A";
const NAMA_KELAS_RACE_B = "uji-a5-task8-race-B";

let app: AppUji;

beforeAll(async () => {
  app = await nyalakanAppUji();
});

beforeEach(async () => {
  await bersihkanDataAdministrasi();
  await pulihkanKomponenAwal();
});
afterEach(async () => {
  await bersihkanDataAdministrasi();
  await pulihkanKomponenAwal();
});

afterAll(async () => {
  try {
    await app.tutup();
  } finally {
    await tutupPool();
  }
});

type GrafKelas = Readonly<{
  kelas: number;
  kelasSiswa: number;
  penugasan: number;
  penugasanKomponen: number;
  rapor: number;
  raporDraft: number;
}>;

type DataKelas = Readonly<{
  periode_ref: string;
  nama: string;
  tingkat: "X" | "XI" | "XII";
  jurusan?: string;
  guru_ref: readonly string[];
  wali_kelas_ref: string;
}>;

function dataKelas(
  nama: string,
  pilihan: Partial<Omit<DataKelas, "nama" | "periode_ref">> = {},
): DataKelas {
  return {
    periode_ref: BENIH.periodeGenap,
    nama,
    tingkat: pilihan.tingkat ?? "X",
    jurusan: pilihan.jurusan ?? "IPA",
    guru_ref: pilihan.guru_ref ?? [BENIH.guruBio],
    wali_kelas_ref: pilihan.wali_kelas_ref ?? BENIH.guruBio,
  };
}

async function formKelas(data: DataKelas, baris: readonly BarisFixtureSiswa[]): Promise<FormData> {
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  form.set(
    "berkas",
    new Blob([await xlsxSiswa(baris)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "daftar-siswa.xlsx",
  );
  return form;
}

async function panggilBuatKelas(
  sesi: string,
  data: DataKelas,
  baris: readonly BarisFixtureSiswa[],
): Promise<JawabanUji> {
  const jawab = await fetch(`${app.asal}/api/kelas`, {
    method: "POST",
    headers: { cookie: sesi },
    body: await formKelas(data, baris),
  });
  return {
    status: jawab.status,
    kepala: jawab.headers,
    badan: await jawab.json(),
  };
}

function barisSiswa(namaKelas: string): readonly BarisFixtureSiswa[] {
  return Object.freeze([
    { kelas: namaKelas, nis: "2026001", nama: "Andi" },
    { kelas: namaKelas, nis: "2026002", nama: "Budi" },
  ]);
}

function barisSiswaTerbalik(namaKelas: string): readonly BarisFixtureSiswa[] {
  return Object.freeze([
    { kelas: namaKelas, nis: "2026002", nama: "Budi" },
    { kelas: namaKelas, nis: "2026001", nama: "Andi" },
  ]);
}

async function jumlahKomponen(): Promise<number> {
  const hasil = await poolPemilik().query<{ jumlah: number }>(
    `SELECT count(*)::int AS jumlah FROM komponen_penilaian`,
  );
  return hasil.rows[0]?.jumlah ?? -1;
}

async function hitungGrafKelas(nama: string): Promise<GrafKelas> {
  const hasil = await poolPemilik().query<GrafKelas>(
    `WITH target AS (SELECT id FROM kelas WHERE nama = $1)
     SELECT
       (SELECT count(*)::int FROM target) AS "kelas",
       (SELECT count(*)::int FROM kelas_siswa WHERE kelas_ref IN (SELECT id FROM target)) AS "kelasSiswa",
       (SELECT count(*)::int FROM penugasan WHERE kelas_ref IN (SELECT id FROM target)) AS "penugasan",
       (SELECT count(*)::int FROM penugasan_komponen
        WHERE penugasan_ref IN (SELECT id FROM penugasan WHERE kelas_ref IN (SELECT id FROM target))) AS "penugasanKomponen",
       (SELECT count(*)::int FROM rapor WHERE kelas_ref IN (SELECT id FROM target)) AS "rapor",
       (SELECT count(*)::int FROM rapor
        WHERE kelas_ref IN (SELECT id FROM target) AND status = 'draft') AS "raporDraft"`,
    [nama],
  );
  const baris = hasil.rows[0];
  if (!baris) throw new Error("Hitungan graf kelas tidak tersedia.");
  return baris;
}

async function hitungGrafBeberapaKelas(nama: readonly string[]): Promise<GrafKelas> {
  const hasil = await poolPemilik().query<GrafKelas>(
    `WITH target AS (SELECT id FROM kelas WHERE nama = ANY($1::text[]))
     SELECT
       (SELECT count(*)::int FROM target) AS "kelas",
       (SELECT count(*)::int FROM kelas_siswa WHERE kelas_ref IN (SELECT id FROM target)) AS "kelasSiswa",
       (SELECT count(*)::int FROM penugasan WHERE kelas_ref IN (SELECT id FROM target)) AS "penugasan",
       (SELECT count(*)::int FROM penugasan_komponen
        WHERE penugasan_ref IN (SELECT id FROM penugasan WHERE kelas_ref IN (SELECT id FROM target))) AS "penugasanKomponen",
       (SELECT count(*)::int FROM rapor WHERE kelas_ref IN (SELECT id FROM target)) AS "rapor",
       (SELECT count(*)::int FROM rapor
        WHERE kelas_ref IN (SELECT id FROM target) AND status = 'draft') AS "raporDraft"`,
    [nama],
  );
  const baris = hasil.rows[0];
  if (!baris) throw new Error("Hitungan graf kelas tidak tersedia.");
  return baris;
}

async function hitungGrafKeseluruhan(): Promise<GrafKelas> {
  const hasil = await poolPemilik().query<GrafKelas>(
    `SELECT
       (SELECT count(*)::int FROM kelas) AS "kelas",
       (SELECT count(*)::int FROM kelas_siswa) AS "kelasSiswa",
       (SELECT count(*)::int FROM penugasan) AS "penugasan",
       (SELECT count(*)::int FROM penugasan_komponen) AS "penugasanKomponen",
       (SELECT count(*)::int FROM rapor) AS "rapor",
       (SELECT count(*)::int FROM rapor WHERE status = 'draft') AS "raporDraft"`,
  );
  const baris = hasil.rows[0];
  if (!baris) throw new Error("Hitungan graf keseluruhan tidak tersedia.");
  return baris;
}

async function tambahKomponenUji(): Promise<void> {
  const klien = await poolPemilik().connect();
  try {
    await klien.query("BEGIN");
    await klien.query(
      `UPDATE komponen_penilaian
       SET bobot = bobot - 1
       WHERE id = (
         SELECT id FROM komponen_penilaian WHERE bobot > 1 ORDER BY urutan LIMIT 1
       )`,
    );
    await klien.query(
      `INSERT INTO komponen_penilaian (id, kode, nama, bobot, urutan)
       VALUES ('10000000-0000-4000-8000-000000000831',
               'uji-a5-task8-dinamis', 'Komponen Dinamis Task 8', 1, 99)`,
    );
    await klien.query("COMMIT");
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
}

async function buatGuruMapel(input: {
  readonly id: string;
  readonly namaPengguna: string;
  readonly nama: string;
  readonly mapelId: string;
  readonly kode: string;
  readonly mapelNama: string;
  readonly tingkat: "X" | "XI" | "XII";
}): Promise<void> {
  await poolPemilik().query(
    `INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ($1, $2, $3, 'guru', 'hash-uji')
     ON CONFLICT DO NOTHING`,
    [input.id, input.namaPengguna, input.nama],
  );
  await poolPemilik().query(`INSERT INTO guru (pengguna_ref) VALUES ($1) ON CONFLICT DO NOTHING`, [
    input.id,
  ]);
  await poolPemilik().query(
    `INSERT INTO mapel (id, kode, nama, tingkat, guru_ref)
       VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [input.mapelId, input.kode, input.mapelNama, input.tingkat, input.id],
  );
}

async function buatKelasKonflikI08(): Promise<void> {
  await poolPemilik().query(
    `INSERT INTO kelas (id, periode_ref, nama, tingkat, wali_kelas_ref)
     VALUES ('10000000-0000-4000-8000-000000000801', $1, 'uji-a5-task8-existing', 'X', NULL)`,
    [BENIH.periodeGenap],
  );
  await poolPemilik().query(
    `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES
       ('10000000-0000-4000-8000-000000000801', $1, $3),
       ('10000000-0000-4000-8000-000000000801', $2, $3)`,
    [BENIH.siswaAndi, BENIH.siswaBudi, BENIH.periodeGenap],
  );
}

describe("POST /api/kelas atomik", () => {
  it("membuat seluruh graf kelas dengan jumlah komponen dinamis", async () => {
    const admin = await masukSebagai(app, "admin");
    const guruTambahan = "10000000-0000-4000-8000-000000000841";
    await buatGuruMapel({
      id: guruTambahan,
      namaPengguna: "uji-a5-task8-guru-sukses",
      nama: "uji-a5-task8 Guru Sukses",
      mapelId: "10000000-0000-4000-8000-000000000851",
      kode: "uji-a5-task8-SUKSES",
      mapelNama: "uji-a5-task8 Mapel Sukses",
      tingkat: "X",
    });
    const komponen = await jumlahKomponen();
    const jawab = await panggilBuatKelas(
      admin,
      dataKelas(NAMA_KELAS_BERHASIL, { guru_ref: [BENIH.guruBio, guruTambahan] }),
      barisSiswa(NAMA_KELAS_BERHASIL),
    );

    expect(jawab.status).toBe(201);
    expect(jawab.badan).toMatchObject({
      data: {
        id: expect.any(String),
        nama: NAMA_KELAS_BERHASIL,
        periode_ref: BENIH.periodeGenap,
        jumlah_siswa: 2,
        jumlah_penugasan: 2,
      },
    });
    await expect(hitungGrafKelas(NAMA_KELAS_BERHASIL)).resolves.toEqual({
      kelas: 1,
      kelasSiswa: 2,
      penugasan: 2,
      penugasanKomponen: komponen * 2,
      rapor: 2,
      raporDraft: 2,
    });
  });

  it("mengambil ulang jumlah komponen yang berubah sebelum transaksi", async () => {
    const admin = await masukSebagai(app, "admin");
    const komponenSebelum = await jumlahKomponen();
    await tambahKomponenUji();
    const komponen = await jumlahKomponen();

    const jawab = await panggilBuatKelas(
      admin,
      dataKelas(NAMA_KELAS_BERHASIL),
      barisSiswa(NAMA_KELAS_BERHASIL),
    );

    expect(jawab.status).toBe(201);
    await expect(hitungGrafKelas(NAMA_KELAS_BERHASIL)).resolves.toEqual({
      kelas: 1,
      kelasSiswa: 2,
      penugasan: 1,
      penugasanKomponen: komponen,
      rapor: 2,
      raporDraft: 2,
    });
    expect(komponen).toBe(komponenSebelum + 1);
  });

  it.each<TabelPemicuGagal>(["kelas_siswa", "penugasan", "penugasan_komponen", "rapor"])(
    "me-roll back seluruh graf ketika sisipan %s gagal",
    async (tabel) => {
      const admin = await masukSebagai(app, "admin");
      const sebelum = await hitungGrafKeseluruhan();
      const lepas = await pasangPemicuGagal(tabel);
      const pencatat = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const jawab = await panggilBuatKelas(
          admin,
          dataKelas(NAMA_KELAS_GAGAL),
          barisSiswa(NAMA_KELAS_GAGAL),
        );

        expect(jawab.status).toBe(500);
        expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KESALAHAN_SERVER" } });
        await expect(hitungGrafKelas(NAMA_KELAS_GAGAL)).resolves.toEqual({
          kelas: 0,
          kelasSiswa: 0,
          penugasan: 0,
          penugasanKomponen: 0,
          rapor: 0,
          raporDraft: 0,
        });
        await expect(hitungGrafKeseluruhan()).resolves.toEqual(sebelum);
      } finally {
        pencatat.mockRestore();
        await lepas();
      }
    },
  );

  it("melaporkan seluruh konflik I-08 dan tidak menyimpan kelas baru", async () => {
    const admin = await masukSebagai(app, "admin");
    await buatKelasKonflikI08();

    const jawab = await panggilBuatKelas(
      admin,
      dataKelas(NAMA_KELAS_KONFLIK),
      barisSiswa(NAMA_KELAS_KONFLIK),
    );

    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({
      kesalahan: {
        kode: "BERKAS_TIDAK_SAH",
        rincian: [
          { baris: 2, nis: "2026001" },
          { baris: 3, nis: "2026002" },
        ],
      },
    });
    await expect(hitungGrafKelas(NAMA_KELAS_KONFLIK)).resolves.toEqual({
      kelas: 0,
      kelasSiswa: 0,
      penugasan: 0,
      penugasanKomponen: 0,
      rapor: 0,
      raporDraft: 0,
    });
  });

  it("menangani race siswa sama ke dua kelas berbeda secara deterministik tanpa 500", async () => {
    const admin = await masukSebagai(app, "admin");
    await buatGuruMapel({
      id: "10000000-0000-4000-8000-000000000811",
      namaPengguna: "uji-a5-task8-guru-a",
      nama: "uji-a5-task8 Guru A",
      mapelId: "10000000-0000-4000-8000-000000000821",
      kode: "uji-a5-task8-A",
      mapelNama: "uji-a5-task8 Mapel A",
      tingkat: "X",
    });
    await buatGuruMapel({
      id: "10000000-0000-4000-8000-000000000812",
      namaPengguna: "uji-a5-task8-guru-b",
      nama: "uji-a5-task8 Guru B",
      mapelId: "10000000-0000-4000-8000-000000000822",
      kode: "uji-a5-task8-B",
      mapelNama: "uji-a5-task8 Mapel B",
      tingkat: "X",
    });
    const komponen = await jumlahKomponen();

    const [jawabA, jawabB] = await Promise.all([
      panggilBuatKelas(
        admin,
        dataKelas(NAMA_KELAS_RACE_A, {
          guru_ref: ["10000000-0000-4000-8000-000000000811"],
          wali_kelas_ref: "10000000-0000-4000-8000-000000000811",
        }),
        barisSiswa(NAMA_KELAS_RACE_A),
      ),
      panggilBuatKelas(
        admin,
        dataKelas(NAMA_KELAS_RACE_B, {
          guru_ref: ["10000000-0000-4000-8000-000000000812"],
          wali_kelas_ref: "10000000-0000-4000-8000-000000000812",
        }),
        barisSiswaTerbalik(NAMA_KELAS_RACE_B),
      ),
    ]);

    const jawaban = [jawabA, jawabB] as const;
    expect(jawaban.map((jawab) => jawab.status).sort((a, b) => a - b)).toEqual([201, 400]);
    expect(jawaban.some((jawab) => jawab.status === 500)).toBe(false);
    const gagal = jawaban.find((jawab) => jawab.status === 400);
    expect(gagal?.badan).toMatchObject({
      kesalahan: {
        kode: "BERKAS_TIDAK_SAH",
        rincian: expect.arrayContaining([
          expect.objectContaining({ nis: "2026001" }),
          expect.objectContaining({ nis: "2026002" }),
        ]),
      },
    });
    await expect(hitungGrafBeberapaKelas([NAMA_KELAS_RACE_A, NAMA_KELAS_RACE_B])).resolves.toEqual({
      kelas: 1,
      kelasSiswa: 2,
      penugasan: 1,
      penugasanKomponen: komponen,
      rapor: 2,
      raporDraft: 2,
    });
  });

  it("memprioritaskan duplikat kelas pada dua request identik yang benar-benar konkuren", async () => {
    const admin = await masukSebagai(app, "admin");
    const pengunci = await poolPemilik().connect();
    let transaksiAktif = false;
    try {
      await pengunci.query("BEGIN");
      transaksiAktif = true;
      await pengunci.query(
        `SELECT pengguna_ref FROM siswa
         WHERE pengguna_ref = ANY($1::uuid[])
         ORDER BY pengguna_ref FOR UPDATE`,
        [[BENIH.siswaAndi, BENIH.siswaBudi]],
      );

      const permintaan = [
        panggilBuatKelas(admin, dataKelas(NAMA_KELAS_BERHASIL), barisSiswa(NAMA_KELAS_BERHASIL)),
        panggilBuatKelas(
          admin,
          dataKelas(NAMA_KELAS_BERHASIL),
          barisSiswaTerbalik(NAMA_KELAS_BERHASIL),
        ),
      ] as const;
      await tungguKueriSiswaTerblokir(2);
      await pengunci.query("COMMIT");
      transaksiAktif = false;

      const jawaban = await Promise.all(permintaan);
      expect(jawaban.map((jawab) => jawab.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(jawaban.some((jawab) => jawab.status === 500)).toBe(false);
      expect(jawaban.find((jawab) => jawab.status === 409)?.badan).toMatchObject({
        kesalahan: { kode: "DATA_SUDAH_ADA" },
      });
      await expect(hitungGrafKelas(NAMA_KELAS_BERHASIL)).resolves.toMatchObject({
        kelas: 1,
        kelasSiswa: 2,
      });
    } finally {
      if (transaksiAktif) await pengunci.query("ROLLBACK").catch(() => undefined);
      pengunci.release();
    }
  });
});

async function tungguKueriSiswaTerblokir(jumlah: number): Promise<void> {
  for (let percobaan = 0; percobaan < 200; percobaan += 1) {
    const hasil = await poolPemilik().query<{ jumlah: number }>(
      `SELECT count(*)::int AS jumlah FROM pg_stat_activity
       WHERE pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND query ILIKE '%from "siswa"%'
         AND query ILIKE '%for update%'`,
    );
    if ((hasil.rows[0]?.jumlah ?? 0) >= jumlah) return;
    await new Promise((selesai) => setTimeout(selesai, 10));
  }
  throw new Error(`Permintaan kelas tidak mencapai ${jumlah} barrier kunci siswa.`);
}
