import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DIREKTORI_MIGRASI, POLA_BERKAS_MIGRASI, uraikanHeader } from "../../src/db/migrasi.js";

// Lapis 0 dan lapis 1 pada DEPLOYMENT.md sec 6.5. Keduanya berbiaya nol dan
// wajib terpasang sebelum migrasi 0001 — linter yang datang belakangan hanya
// memeriksa yang sudah terlanjur ada.

async function bacaBerkasMigrasi(): Promise<string[]> {
  const isi = await readdir(DIREKTORI_MIGRASI);
  return isi.filter((berkas) => berkas.endsWith(".sql")).sort();
}

describe("penamaan berkas migrasi — lapis 1", () => {
  it("menolak nama yang tidak menyatakan nomor dan fasenya", () => {
    expect(POLA_BERKAS_MIGRASI.test("0001_identitas.sql")).toBe(false);
    expect(POLA_BERKAS_MIGRASI.test("identitas.sql")).toBe(false);
    expect(POLA_BERKAS_MIGRASI.test("1_expand_identitas.sql")).toBe(false);
    expect(POLA_BERKAS_MIGRASI.test("0001_ekspansi_identitas.sql")).toBe(false);
  });

  it("menerima expand dan contract yang bernomor empat digit", () => {
    expect(POLA_BERKAS_MIGRASI.test("0001_expand_identitas.sql")).toBe(true);
    expect(POLA_BERKAS_MIGRASI.test("0013_contract_hapus_kkm.sql")).toBe(true);
  });

  it("setiap berkas di migrations/ mengikuti polanya", async () => {
    const berkas = await bacaBerkasMigrasi();
    expect(berkas.length).toBeGreaterThan(0);

    for (const nama of berkas) {
      expect(POLA_BERKAS_MIGRASI.test(nama), `${nama} tidak mengikuti pola`).toBe(true);
    }
  });

  it("nomornya berurutan tanpa lompatan maupun kembar", async () => {
    const berkas = await bacaBerkasMigrasi();
    const nomor = berkas.map((nama) => Number(nama.slice(0, 4)));

    expect(nomor).toEqual(nomor.map((_, indeks) => indeks + 1));
  });
});

describe("header klasifikasi — lapis 0", () => {
  it("menolak berkas tanpa header sama sekali", () => {
    const hasil = uraikanHeader("CREATE TABLE contoh (id uuid PRIMARY KEY);");

    expect(hasil.sah).toBe(false);
  });

  it("menolak jenis di luar keempat nilai yang diakui", () => {
    const hasil = uraikanHeader(
      [
        "-- migrasi : 0001",
        "-- jenis   : tambahan",
        "-- mundur  : ya — tabel baru",
        "-- dibaca  : api",
        "-- penutup : —",
      ].join("\n"),
    );

    expect(hasil.sah).toBe(false);
  });

  it("menolak baris mundur yang menjawab tidak tanpa alasannya", () => {
    const hasil = uraikanHeader(
      [
        "-- migrasi : 0001",
        "-- jenis   : breaking",
        "-- mundur  : tidak",
        "-- dibaca  : api",
        "-- penutup : —",
      ].join("\n"),
    );

    expect(hasil.sah).toBe(false);
  });

  it("menerima header lengkap dan mengurainya", () => {
    const hasil = uraikanHeader(
      [
        "-- migrasi : 0011",
        "-- jenis   : additive",
        "-- mundur  : ya — kolom baru bernilai bawaan",
        "-- dibaca  : api, migrate, app_ro",
        "-- penutup : 0013",
        "",
        "ALTER TABLE mapel ADD COLUMN deskripsi text;",
      ].join("\n"),
    );

    expect(hasil.sah).toBe(true);
    if (!hasil.sah) return;

    expect(hasil.header.migrasi).toBe("0011");
    expect(hasil.header.jenis).toBe("additive");
    expect(hasil.header.dibaca).toEqual(["api", "migrate", "app_ro"]);
    expect(hasil.header.penutup).toBe("0013");
  });

  it("setiap berkas di migrations/ memiliki header yang sah dan cocok nomornya", async () => {
    const berkas = await bacaBerkasMigrasi();

    for (const nama of berkas) {
      const isi = await readFile(path.join(DIREKTORI_MIGRASI, nama), "utf8");
      const hasil = uraikanHeader(isi);

      expect(hasil.sah, `${nama}: ${hasil.sah ? "" : hasil.sebab}`).toBe(true);
      if (!hasil.sah) continue;

      expect(hasil.header.migrasi, `${nama} menyebut nomor yang berbeda`).toBe(nama.slice(0, 4));
    }
  });

  it("setiap contract menyebut nomor expand yang ditutupnya", async () => {
    const berkas = await bacaBerkasMigrasi();

    for (const nama of berkas.filter((n) => n.includes("_contract_"))) {
      const isi = await readFile(path.join(DIREKTORI_MIGRASI, nama), "utf8");
      const hasil = uraikanHeader(isi);
      if (!hasil.sah) continue;

      expect(hasil.header.penutup, `${nama} tidak menyebut expand yang ditutupnya`).toMatch(
        /^\d{4}$/,
      );
    }
  });
});
