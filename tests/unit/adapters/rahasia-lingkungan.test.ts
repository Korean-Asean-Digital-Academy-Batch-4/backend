import { describe, expect, it } from "vitest";

import { rahasiaLingkungan } from "../../../src/adapters/local/rahasia.js";

const ENV = {
  DATABASE_URL: "postgres://rw@lokal/edutrack",
  DATABASE_URL_RO: "postgres://ro@lokal/edutrack",
  DATABASE_URL_MIGRASI: "postgres://owner@lokal/edutrack",
  ELICE_API_KEY: "kunci-uji",
};

describe("rahasiaLingkungan", () => {
  it("memetakan setiap peran basis data ke variabel lingkungannya", async () => {
    const rahasia = rahasiaLingkungan(ENV);

    await expect(rahasia.urlBasisData("app_rw")).resolves.toBe(ENV.DATABASE_URL);
    await expect(rahasia.urlBasisData("app_ro")).resolves.toBe(ENV.DATABASE_URL_RO);
    await expect(rahasia.urlBasisData("owner")).resolves.toBe(ENV.DATABASE_URL_MIGRASI);
  });

  it("membaca kunci API jalur AI", async () => {
    await expect(rahasiaLingkungan(ENV).kunciApiAi()).resolves.toBe("kunci-uji");
  });

  it("menyebut nama variabel yang kosong, bukan sekadar gagal", async () => {
    const rahasia = rahasiaLingkungan({ ...ENV, DATABASE_URL_RO: undefined });

    await expect(rahasia.urlBasisData("app_ro")).rejects.toThrow(/DATABASE_URL_RO/);
  });

  it("menolak kunci API yang kosong", async () => {
    const rahasia = rahasiaLingkungan({ ...ENV, ELICE_API_KEY: "" });

    await expect(rahasia.kunciApiAi()).rejects.toThrow(/ELICE_API_KEY/);
  });
});
