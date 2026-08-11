import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { buatLayananMigrasi } from "../../../src/entry/layanan-migrasi.js";
import { bacaPeran } from "../../../src/entry/peran.js";

// Fungsi migrate menyala sebagai layanan HTTP berumur pendek — CK-D-08. Yang
// diuji di sini kontraknya terhadap Lambda Web Adapter: readiness lulus tanpa
// menyentuh basis data, dan penerapan berjalan ketika invocation datang.

let tutup: (() => Promise<void>) | undefined;

async function nyalakan(terapkan: () => Promise<readonly string[]>) {
  const server = buatLayananMigrasi({ terapkan });
  await new Promise<void>((selesai) => server.listen(0, "127.0.0.1", selesai));
  const { port } = server.address() as AddressInfo;

  tutup = () => new Promise<void>((selesai) => server.close(() => selesai()));
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await tutup?.();
  tutup = undefined;
});

describe("buatLayananMigrasi", () => {
  it("menjawab readiness TANPA menerapkan migrasi", async () => {
    let dipanggil = 0;
    const dasar = await nyalakan(async () => {
      dipanggil += 1;
      return [];
    });

    for (const jalur of ["/healthz", "/api/healthz"]) {
      const jawaban = await fetch(`${dasar}${jalur}`);

      expect(jawaban.status).toBe(200);
      await expect(jawaban.json()).resolves.toMatchObject({ data: { peran: "migrasi" } });
    }

    // Readiness check dipanggil pada setiap cold start. Menerapkan migrasi di
    // sana berarti menerapkannya berkali-kali tanpa ada yang memintanya.
    expect(dipanggil).toBe(0);
  });

  it("menerapkan migrasi pada invocation, dan menyebut berkas yang dijalankan", async () => {
    const dasar = await nyalakan(async () => ["0011_expand_contoh.sql"]);

    const jawaban = await fetch(`${dasar}/migrasi`, { method: "POST", body: "{}" });

    expect(jawaban.status).toBe(200);
    await expect(jawaban.json()).resolves.toEqual({
      data: { berhasil: true, diterapkan: ["0011_expand_contoh.sql"] },
    });
  });

  it("menerima jalur pass-through bawaan adapter sebagai jaring pengaman", async () => {
    const dasar = await nyalakan(async () => []);

    const jawaban = await fetch(`${dasar}/events`, { method: "POST", body: "{}" });

    expect(jawaban.status).toBe(200);
    await expect(jawaban.json()).resolves.toEqual({ data: { berhasil: true, diterapkan: [] } });
  });

  it("melaporkan kegagalan sebagai 500 beserta sebabnya, bukan sebagai proses yang mati", async () => {
    const dasar = await nyalakan(async () => {
      throw new Error("relation sudah ada");
    });

    const jawaban = await fetch(`${dasar}/migrasi`, { method: "POST", body: "{}" });

    expect(jawaban.status).toBe(500);
    // Pipeline memeriksa isi jawabannya, bukan status invocation-nya:
    // `aws lambda invoke` mengembalikan 200 selama fungsinya tidak melempar.
    await expect(jawaban.json()).resolves.toMatchObject({
      kesalahan: { kode: "MIGRASI_GAGAL" },
      data: { berhasil: false, sebab: "relation sudah ada" },
    });
  });

  it("menolak jalur lain, sehingga fungsi migrate tidak menyerupai aplikasi", async () => {
    const dasar = await nyalakan(async () => []);

    const jawaban = await fetch(`${dasar}/api/nilai`, { method: "POST", body: "{}" });

    expect(jawaban.status).toBe(404);
  });
});

describe("bacaPeran", () => {
  it("berperan api ketika PERAN tidak disetel", () => {
    expect(bacaPeran({})).toBe("api");
  });

  it("membaca peran migrasi", () => {
    expect(bacaPeran({ PERAN: "migrasi" })).toBe("migrasi");
  });

  it("menolak nilai yang tidak dikenal, dan menyebut nilai yang sah", () => {
    expect(() => bacaPeran({ PERAN: "migrate" })).toThrow(/api, migrasi/);
  });
});
