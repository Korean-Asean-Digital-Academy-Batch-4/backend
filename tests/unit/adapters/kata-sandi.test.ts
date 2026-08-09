import { describe, expect, it } from "vitest";

import {
  PANJANG_KATA_SANDI_AWAL,
  buatKataSandiAwal,
  kataSandiArgon2id,
} from "../../../src/adapters/local/kata-sandi.js";

// Techstack.md sec 5: Argon2id, tanpa syarat kerumitan, tanpa kewajiban ganti
// pada masuk pertama. Kata sandi awal dihasilkan sistem (PRD sec 6.1.3, P17).

const kataSandi = kataSandiArgon2id();

describe("hash Argon2id", () => {
  it("menghasilkan hash bertanda argon2id", async () => {
    const hash = await kataSandi.hash("rahasia-uji");

    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("tidak pernah memuat kata sandi aslinya", async () => {
    const hash = await kataSandi.hash("rahasia-uji");

    expect(hash).not.toContain("rahasia-uji");
  });

  it("menghasilkan hash berbeda untuk kata sandi yang sama", async () => {
    const [a, b] = await Promise.all([kataSandi.hash("sama"), kataSandi.hash("sama")]);

    expect(a).not.toBe(b);
  });

  it("menerima kata sandi yang benar", async () => {
    const hash = await kataSandi.hash("benar");

    expect(await kataSandi.verifikasi(hash, "benar")).toBe(true);
  });

  it("menolak kata sandi yang keliru", async () => {
    const hash = await kataSandi.hash("benar");

    expect(await kataSandi.verifikasi(hash, "keliru")).toBe(false);
  });

  it("menolak hash yang rusak tanpa melempar galat", async () => {
    expect(await kataSandi.verifikasi("bukan-hash-argon2", "apa pun")).toBe(false);
  });

  it("menolak hash kosong tanpa melempar galat", async () => {
    expect(await kataSandi.verifikasi("", "apa pun")).toBe(false);
  });

  it("menerima kata sandi tanpa syarat kerumitan — PRD sec 6.1.3", async () => {
    for (const polos of ["a", "1", "        ", "seluruhnya huruf kecil tanpa angka"]) {
      const hash = await kataSandi.hash(polos);
      expect(await kataSandi.verifikasi(hash, polos)).toBe(true);
    }
  });
});

describe("verifikasi tiruan", () => {
  it("selalu menghasilkan false, dan tidak melempar", async () => {
    expect(await kataSandi.verifikasiTiruan("apa pun")).toBe(false);
  });
});

describe("kata sandi awal", () => {
  it("berpanjang tetap sesuai ketetapan", async () => {
    expect(buatKataSandiAwal()).toHaveLength(PANJANG_KATA_SANDI_AWAL);
  });

  it("tidak pernah sama dua kali", () => {
    const seratus = new Set(Array.from({ length: 100 }, () => buatKataSandiAwal()));

    expect(seratus.size).toBe(100);
  });

  it("hanya memakai aksara yang tidak rancu saat dibacakan", () => {
    const gabungan = Array.from({ length: 200 }, () => buatKataSandiAwal()).join("");

    // Tanpa 0/O dan 1/l/I, karena kata sandi ini dibacakan Administrator
    // kepada pengguna secara lisan atau tertulis tangan (PRD sec 6.1.3).
    expect(gabungan).not.toMatch(/[0O1lI]/);
    expect(gabungan).toMatch(/^[A-Za-z0-9]+$/);
  });
});
