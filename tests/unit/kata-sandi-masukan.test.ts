import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { bacaDariAliran, bersihkanKataSandi } from "../../src/entry/kata-sandi-masukan.js";

// CK-A-09: kata sandi bootstrap dibaca dari stdin, bukan dari argumen proses.
// Satu akhir baris di ujung dibuang, sehingga printf maupun echo sama bekerja.

describe("bersihkanKataSandi", () => {
  it("membiarkan kata sandi tanpa akhir baris apa adanya", () => {
    expect(bersihkanKataSandi("katasandi-awal")).toBe("katasandi-awal");
  });

  it("membuang satu akhir baris di ujung — keluaran echo", () => {
    expect(bersihkanKataSandi("katasandi-awal\n")).toBe("katasandi-awal");
  });

  it("membuang akhir baris bergaya Windows", () => {
    expect(bersihkanKataSandi("katasandi-awal\r\n")).toBe("katasandi-awal");
  });

  it("membuang HANYA satu akhir baris, bukan seluruhnya", () => {
    expect(bersihkanKataSandi("katasandi\n\n")).toBe("katasandi\n");
  });

  it("mempertahankan spasi yang disengaja di ujung", () => {
    expect(bersihkanKataSandi("kata sandi saya  \n")).toBe("kata sandi saya  ");
  });

  it("mempertahankan spasi sebagai kata sandi yang sah", () => {
    expect(bersihkanKataSandi("   ")).toBe("   ");
  });
});

describe("bacaDariAliran", () => {
  it("membaca kata sandi dari pipa", async () => {
    expect(await bacaDariAliran(Readable.from(["katasandi-awal"]))).toBe("katasandi-awal");
  });

  it("menggabungkan potongan yang datang terpisah", async () => {
    expect(await bacaDariAliran(Readable.from(["kata", "sandi", "-awal\n"]))).toBe(
      "katasandi-awal",
    );
  });

  it("mengembalikan string kosong untuk pipa kosong", async () => {
    expect(await bacaDariAliran(Readable.from([]))).toBe("");
  });

  it("tidak merusak aksara di luar ASCII", async () => {
    expect(await bacaDariAliran(Readable.from(["sandiku-café-2026\n"]))).toBe("sandiku-café-2026");
  });
});
