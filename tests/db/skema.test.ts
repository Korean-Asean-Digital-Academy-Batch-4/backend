import { afterAll, describe, expect, it } from "vitest";

import { DIREKTORI_MIGRASI, terapkanMigrasi } from "../../src/db/migrasi.js";
import { poolPemilik, tutupPool } from "./bantuan.js";

// Bentuk skema yang dihasilkan kesepuluh migrasi, diperiksa terhadap SCHEMA.md
// Pasal 3, sec 5.2, dan sec 9. Bukan menyalin isi dokumen, melainkan membuktikan
// migrasinya menghasilkan apa yang dokumen nyatakan.

// SCHEMA.md Pasal 3 — sembilan belas tabel, tidak lebih dan tidak kurang.
const TABEL = [
  "audit_log",
  "guru",
  "kelas",
  "kelas_siswa",
  "komponen_penilaian",
  "mapel",
  "nilai",
  "pembatas_laju",
  "pengguna",
  "penugasan",
  "penugasan_komponen",
  "periode",
  "presensi",
  "rapor",
  "rapor_mapel",
  "sesi",
  "sesi_masuk",
  "siswa",
  "tahun_ajaran",
];

afterAll(tutupPool);

describe("Pasal 3 — peta tabel", () => {
  it("membangun tepat sembilan belas tabel di dalam public", async () => {
    const hasil = await poolPemilik().query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    expect(hasil.rows.map((baris) => baris.tablename)).toEqual(TABEL);
  });

  it("menempatkan catatan penerapan di luar public — CK-S-10", async () => {
    const hasil = await poolPemilik().query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'migrasi'`,
    );

    expect(hasil.rows.map((baris) => baris.tablename)).toEqual(["diterapkan"]);
  });

  it("tidak membangun satu pun entitas yang gugur — RFC-001 sec 7", async () => {
    const gugur = [
      "rumus",
      "komponen_rumus",
      "penugasan_rumus",
      "penilaian_sikap",
      "ai_insight",
      "materi",
    ];

    const hasil = await poolPemilik().query<{ jumlah: string }>(
      `SELECT count(*)::text AS jumlah FROM pg_tables
       WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [gugur],
    );

    expect(hasil.rows[0]?.jumlah).toBe("0");
  });
});

describe("sec 5.2 — dua pemicu", () => {
  it("memasang trg_komponen_bobot dan trg_rapor_status_maju", async () => {
    const hasil = await poolPemilik().query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname`,
    );

    expect(hasil.rows.map((baris) => baris.tgname)).toEqual([
      "trg_komponen_bobot",
      "trg_rapor_status_maju",
    ]);
  });

  it("menangguhkan trg_komponen_bobot sampai COMMIT", async () => {
    const hasil = await poolPemilik().query<{ tgdeferrable: boolean; tginitdeferred: boolean }>(
      `SELECT tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = 'trg_komponen_bobot'`,
    );

    expect(hasil.rows[0]).toEqual({ tgdeferrable: true, tginitdeferred: true });
  });
});

describe("sec 9.2 — data awal", () => {
  it("menyisipkan delapan komponen penilaian yang berjumlah 100", async () => {
    const hasil = await poolPemilik().query<{ jumlah: string; total: string }>(
      `SELECT count(*)::text AS jumlah, sum(bobot)::text AS total FROM komponen_penilaian`,
    );

    expect(hasil.rows[0]).toEqual({ jumlah: "8", total: "100" });
  });

  it("menyusunnya berurutan sesuai templat", async () => {
    const hasil = await poolPemilik().query<{ kode: string }>(
      `SELECT kode FROM komponen_penilaian ORDER BY urutan`,
    );

    expect(hasil.rows.map((baris) => baris.kode)).toEqual([
      "T1",
      "T2",
      "T3",
      "U1",
      "U2",
      "U3",
      "UTS",
      "UAS",
    ]);
  });

  it("tidak meninggalkan satu pun akun bawaan", async () => {
    const hasil = await poolPemilik().query<{ jumlah: string }>(
      `SELECT count(*)::text AS jumlah FROM pengguna WHERE peran = 'administrator'
       AND kata_sandi_hash <> 'x'`,
    );

    expect(hasil.rows[0]?.jumlah).toBe("0");
  });
});

describe("penerap migrasi", () => {
  it("tidak menerapkan apa pun pada pemanggilan kedua — DEPLOYMENT sec 3.3 langkah 6", async () => {
    const diterapkan = await terapkanMigrasi(poolPemilik(), DIREKTORI_MIGRASI);

    expect(diterapkan).toEqual([]);
  });

  it("mencatat kesepuluh berkas beserta sidik jarinya", async () => {
    const hasil = await poolPemilik().query<{ berkas: string; sidik_jari: string }>(
      `SELECT berkas, sidik_jari FROM migrasi.diterapkan ORDER BY berkas`,
    );

    expect(hasil.rows).toHaveLength(10);
    for (const baris of hasil.rows) {
      expect(baris.sidik_jari).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("menolak melanjutkan ketika berkas yang sudah diterapkan berubah isinya", async () => {
    const berkas = "0001_expand_identitas.sql";
    const semula = await poolPemilik().query<{ sidik_jari: string }>(
      `UPDATE migrasi.diterapkan SET sidik_jari = repeat('0', 64) WHERE berkas = $1
       RETURNING (SELECT sidik_jari FROM migrasi.diterapkan WHERE berkas = $1) AS sidik_jari`,
      [berkas],
    );
    const asli = semula.rows[0]?.sidik_jari;
    expect(asli).toMatch(/^[0-9a-f]{64}$/);

    try {
      await expect(terapkanMigrasi(poolPemilik(), DIREKTORI_MIGRASI)).rejects.toThrow(
        /berubah isinya/,
      );
    } finally {
      await poolPemilik().query(`UPDATE migrasi.diterapkan SET sidik_jari = $2 WHERE berkas = $1`, [
        berkas,
        asli,
      ]);
    }
  });
});
