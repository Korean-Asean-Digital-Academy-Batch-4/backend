import { describe, expect, it } from "vitest";

import { UMUR_SESI_MS, hitungKedaluwarsa, sudahKedaluwarsa } from "../../../src/domain/sesi.js";

// ARCHITECTURE.md sec 9.1: umur sesi 12 jam, TANPA perpanjangan otomatis.
// Pencabutan berlaku seketika pada request berikutnya (CK-A-04).

const SEKARANG = new Date("2026-08-08T07:00:00+07:00");

describe("umur sesi", () => {
  it("berumur tepat 12 jam", () => {
    expect(UMUR_SESI_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("menghitung kedaluwarsa 12 jam sesudah dibuat", () => {
    expect(hitungKedaluwarsa(SEKARANG)).toEqual(new Date("2026-08-08T19:00:00+07:00"));
  });

  it("tidak mengubah tanggal yang diberikan", () => {
    const salinan = new Date(SEKARANG);
    hitungKedaluwarsa(SEKARANG);

    expect(SEKARANG).toEqual(salinan);
  });
});

describe("sudahKedaluwarsa", () => {
  const kedaluwarsa = hitungKedaluwarsa(SEKARANG);

  it("menerima sesi yang masih berlaku", () => {
    expect(sudahKedaluwarsa(kedaluwarsa, SEKARANG)).toBe(false);
  });

  it("menolak sesi yang sudah lewat satu milidetik", () => {
    const lewat = new Date(kedaluwarsa.getTime() + 1);

    expect(sudahKedaluwarsa(kedaluwarsa, lewat)).toBe(true);
  });

  it("menolak tepat pada detik kedaluwarsanya", () => {
    expect(sudahKedaluwarsa(kedaluwarsa, kedaluwarsa)).toBe(true);
  });

  it("tidak memperpanjang sendiri — pemakaian tidak menggeser kedaluwarsa", () => {
    const setengahJalan = new Date(SEKARANG.getTime() + UMUR_SESI_MS / 2);

    expect(sudahKedaluwarsa(kedaluwarsa, setengahJalan)).toBe(false);
    expect(hitungKedaluwarsa(SEKARANG)).toEqual(kedaluwarsa);
  });
});
