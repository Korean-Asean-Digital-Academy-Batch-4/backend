import { describe, expect, it } from "vitest";
import { bacaKonfigurasi, bacaKonfigurasiMigrasi } from "../../src/config.js";

const LENGKAP = { DATABASE_URL: "postgres://rw", DATABASE_URL_RO: "postgres://ro" };

describe("bacaKonfigurasi", () => {
  it("memakai nilai bawaan ketika hanya kedua URL diberikan", () => {
    const k = bacaKonfigurasi(LENGKAP);

    expect(k.PORT).toBe(8080);
    // Bawaan 1 mengikuti disiplin pool Lambda — ARCHITECTURE.md Pasal 6.
    expect(k.DB_POOL_MAX).toBe(1);
  });

  it("menolak konfigurasi tanpa DATABASE_URL", () => {
    expect(() => bacaKonfigurasi({ DATABASE_URL_RO: "postgres://ro" })).toThrow();
  });

  it("menolak konfigurasi tanpa DATABASE_URL_RO — jalur AI menuntut app_ro", () => {
    expect(() => bacaKonfigurasi({ DATABASE_URL: "postgres://rw" })).toThrow();
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
