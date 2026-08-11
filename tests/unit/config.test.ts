import { describe, expect, it } from "vitest";
import {
  bacaKonfigurasi,
  bacaKonfigurasiMigrasi,
  rakitKonfigurasi,
  rakitKonfigurasiMigrasi,
} from "../../src/config.js";
import type { Rahasia } from "../../src/ports/rahasia.js";

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

const RAHASIA_TIRUAN: Rahasia = {
  urlBasisData: async (peran) => `postgres://${peran}@rahasia/edutrack`,
  kunciApiAi: async () => "kunci-dari-rahasia",
};

describe("rakitKonfigurasi", () => {
  it("mengambil ketiga nilai rahasia dari port, bukan dari lingkungan", async () => {
    const k = await rakitKonfigurasi(
      {
        ELICE_BASE_URL: "https://mlapi.run/contoh",
        ELICE_MODEL: "gemini-3.6-flash",
        // Sengaja ada di lingkungan, dan sengaja tidak dipakai.
        DATABASE_URL: "postgres://dari-lingkungan",
        ELICE_API_KEY: "kunci-dari-lingkungan",
      },
      RAHASIA_TIRUAN,
    );

    expect(k.DATABASE_URL).toBe("postgres://app_rw@rahasia/edutrack");
    expect(k.DATABASE_URL_RO).toBe("postgres://app_ro@rahasia/edutrack");
    expect(k.ELICE_API_KEY).toBe("kunci-dari-rahasia");
  });

  it("tetap membaca tetapan yang bukan rahasia dari lingkungan", async () => {
    const k = await rakitKonfigurasi(
      {
        ELICE_BASE_URL: "https://mlapi.run/contoh",
        ELICE_MODEL: "gemini-3.6-flash",
        DB_POOL_MAX: "10",
        PORT: "3000",
      },
      RAHASIA_TIRUAN,
    );

    expect(k.DB_POOL_MAX).toBe(10);
    expect(k.PORT).toBe(3000);
  });
});

describe("rakitKonfigurasiMigrasi", () => {
  it("mengambil kredensial pemilik dari port", async () => {
    const k = await rakitKonfigurasiMigrasi({}, RAHASIA_TIRUAN);

    expect(k.DATABASE_URL_MIGRASI).toBe("postgres://owner@rahasia/edutrack");
  });

  it("TIDAK meminta kredensial selain pemilik", async () => {
    const diminta: string[] = [];
    await rakitKonfigurasiMigrasi(
      {},
      {
        urlBasisData: async (peran) => {
          diminta.push(peran);
          return "postgres://owner";
        },
        kunciApiAi: async () => {
          throw new Error("fungsi migrate tidak boleh menyentuh kunci AI");
        },
      },
    );

    expect(diminta).toEqual(["owner"]);
  });
});
