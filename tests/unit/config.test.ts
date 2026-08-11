import { describe, expect, it } from "vitest";
import { bacaKonfigurasi, bacaKonfigurasiMigrasi } from "../../src/config.js";

const LENGKAP = {
  DATABASE_URL: "postgres://rw",
  DATABASE_URL_RO: "postgres://ro",
  ELICE_BASE_URL: "https://mlapi.run/contoh",
  ELICE_MODEL: "gemini-3.6-flash",
  ELICE_API_KEY: "kunci-uji",
};

describe("bacaKonfigurasi", () => {
  it("memakai nilai bawaan ketika hanya nilai wajib diberikan", () => {
    const k = bacaKonfigurasi(LENGKAP);

    expect(k.PORT).toBe(8080);
    // Bawaan 1 mengikuti disiplin pool Lambda — ARCHITECTURE.md Pasal 6.
    expect(k.DB_POOL_MAX).toBe(1);
  });

  it("menolak konfigurasi tanpa DATABASE_URL", () => {
    expect(() => bacaKonfigurasi({ ...LENGKAP, DATABASE_URL: undefined })).toThrow();
  });

  it("menolak ELICE_BASE_URL yang contoh id endpointnya belum diganti", () => {
    expect(() =>
      bacaKonfigurasi({ ...LENGKAP, ELICE_BASE_URL: "https://mlapi.run/{endpoint-id}" }),
    ).toThrow(/endpoint-id/);
  });

  it("menolak ELICE_BASE_URL yang bukan URL", () => {
    expect(() => bacaKonfigurasi({ ...LENGKAP, ELICE_BASE_URL: "mlapi.run/abc" })).toThrow();
  });

  it("menolak konfigurasi tanpa kunci Elice — jalur AI menuntut kredensialnya", () => {
    expect(() => bacaKonfigurasi({ ...LENGKAP, ELICE_API_KEY: undefined })).toThrow();
  });

  it("menolak konfigurasi tanpa DATABASE_URL_RO — jalur AI menuntut app_ro", () => {
    expect(() => bacaKonfigurasi({ ...LENGKAP, DATABASE_URL_RO: undefined })).toThrow();
  });

  it("membaca DB_POOL_MAX dari lingkungan untuk pemakaian di luar Lambda", () => {
    const k = bacaKonfigurasi({ ...LENGKAP, DB_POOL_MAX: "10" });

    expect(k.DB_POOL_MAX).toBe(10);
  });

  it("TIDAK mengenal DATABASE_URL_MIGRASI — kredensial pemilik di luar jangkauannya", () => {
    const k = bacaKonfigurasi({ ...LENGKAP, DATABASE_URL_MIGRASI: "postgres://owner" });

    expect(k).not.toHaveProperty("DATABASE_URL_MIGRASI");
  });
});

describe("bacaKonfigurasiMigrasi", () => {
  it("membaca kredensial pemilik", () => {
    const k = bacaKonfigurasiMigrasi({ DATABASE_URL_MIGRASI: "postgres://owner" });

    expect(k.DATABASE_URL_MIGRASI).toBe("postgres://owner");
  });

  it("menolak konfigurasi tanpa DATABASE_URL_MIGRASI", () => {
    expect(() => bacaKonfigurasiMigrasi(LENGKAP)).toThrow();
  });
});
