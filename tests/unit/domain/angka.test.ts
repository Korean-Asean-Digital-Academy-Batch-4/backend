import { describe, expect, it } from "vitest";

import { bagiBulatSetengahKeAtas, dariSen, keSen } from "../../../src/domain/angka.js";

describe("bagiBulatSetengahKeAtas", () => {
  it("membulatkan setengah ke atas", () => {
    expect(bagiBulatSetengahKeAtas(5, 2)).toBe(3);
    expect(bagiBulatSetengahKeAtas(7, 2)).toBe(4);
  });

  it("membulatkan ke bawah di bawah setengah", () => {
    expect(bagiBulatSetengahKeAtas(4, 3)).toBe(1);
    expect(bagiBulatSetengahKeAtas(2, 3)).toBe(1);
    expect(bagiBulatSetengahKeAtas(1, 3)).toBe(0);
  });

  it("mengembalikan hasil bagi yang tepat tanpa pembulatan", () => {
    expect(bagiBulatSetengahKeAtas(100, 4)).toBe(25);
    expect(bagiBulatSetengahKeAtas(0, 7)).toBe(0);
  });

  it("menolak penyebut nol alih-alih menghasilkan Infinity", () => {
    expect(() => bagiBulatSetengahKeAtas(1, 0)).toThrow(RangeError);
  });

  it("menolak penyebut negatif", () => {
    expect(() => bagiBulatSetengahKeAtas(1, -2)).toThrow(/lebih besar dari nol/);
  });
});

describe("keSen dan dariSen", () => {
  it("mengubah dua desimal menjadi bilangan bulat sen", () => {
    expect(keSen(80.01)).toBe(8001);
    expect(keSen(0)).toBe(0);
    expect(keSen(100)).toBe(10000);
  });

  it("bertahan terhadap dua desimal yang tidak tepat dalam biner", () => {
    // Tidak satu pun di bawah ini dapat dinyatakan tepat sebagai pecahan biner
    expect(keSen(70.35)).toBe(7035);
    expect(keSen(82.15)).toBe(8215);
    expect(keSen(0.07)).toBe(7);
    expect(keSen(1.13)).toBe(113);
    expect(keSen(29.99)).toBe(2999);
  });

  it("kembali utuh setelah bolak-balik", () => {
    for (const nilai of [0, 0.01, 62.5, 76.49, 100]) {
      expect(dariSen(keSen(nilai))).toBe(nilai);
    }
  });
});
