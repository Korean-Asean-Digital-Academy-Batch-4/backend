import { describe, expect, it } from "vitest";

import type { Komponen } from "../../../src/domain/nilai.js";
import {
  bentukNilaiAkhirSiswa,
  pivotBarisNilai,
  type BarisNilai,
} from "../../../src/domain/siswa.js";

// Komponen templat bawaan V1 — PRD §8.3.
const TEMPLAT: readonly Komponen[] = [
  { kode: "T1", bobot: 6 },
  { kode: "T2", bobot: 6 },
  { kode: "T3", bobot: 6 },
  { kode: "U1", bobot: 10 },
  { kode: "U2", bobot: 10 },
  { kode: "U3", bobot: 10 },
  { kode: "UTS", bobot: 26 },
  { kode: "UAS", bobot: 26 },
];

describe("pivotBarisNilai", () => {
  it("mengubah daftar memanjang menjadi map bersarang per siswa dan komponen", () => {
    const baris: readonly BarisNilai[] = [
      { siswaRef: "s1", komponenRef: "k1", nilai: 85 },
      { siswaRef: "s1", komponenRef: "k2", nilai: 90.5 },
      { siswaRef: "s2", komponenRef: "k1", nilai: 70 },
    ];
    const peta = pivotBarisNilai(baris);
    expect(peta.get("s1")?.get("k1")).toBe(85);
    expect(peta.get("s1")?.get("k2")).toBe(90.5);
    expect(peta.get("s2")?.get("k1")).toBe(70);
    expect(peta.get("s2")?.get("k2")).toBeUndefined();
    expect(peta.get("asing")).toBeUndefined();
  });

  it("tidak memuat pasangan yang tidak ada barisnya — I-12: kosong bukan nol", () => {
    const peta = pivotBarisNilai([]);
    expect(peta.size).toBe(0);
  });
});

describe("bentukNilaiAkhirSiswa", () => {
  it("mengembalikan lengkap beserta nilai akhir terbobot ketika seluruh komponen terisi — AC-05", () => {
    // Seluruh 80: 80*6*3 + 80*10*3 + 80*26*2 = 80*100 / 100 = 80
    const baris = TEMPLAT.map((k, i) => ({
      siswaRef: "s1",
      komponenRef: `k${i}`,
      nilai: 80,
    }));
    const komponen = TEMPLAT.map((k, i) => ({ id: `k${i}`, kode: k.kode, bobot: k.bobot }));
    const hasil = bentukNilaiAkhirSiswa(komponen, baris, "s1");
    expect(hasil).toEqual({ lengkap: true, nilaiAkhir: 80 });
  });

  it("menolak menghitung selama satu komponen belum terisi — AC-06, PRD §8.3", () => {
    // UAS kosong
    const komponen = TEMPLAT.map((k, i) => ({ id: `k${i}`, kode: k.kode, bobot: k.bobot }));
    const baris = TEMPLAT.slice(0, 7).map((k, i) => ({
      siswaRef: "s1",
      komponenRef: `k${i}`,
      nilai: 80,
    }));
    const hasil = bentukNilaiAkhirSiswa(komponen, baris, "s1");
    expect(hasil).toEqual({ lengkap: false, nilaiAkhir: null });
  });

  it("nilai nol adalah nilai terisi, bukan kosong — I-12", () => {
    const komponen = TEMPLAT.map((k, i) => ({ id: `k${i}`, kode: k.kode, bobot: k.bobot }));
    const baris = TEMPLAT.map((k, i) => ({ siswaRef: "s1", komponenRef: `k${i}`, nilai: 0 }));
    const hasil = bentukNilaiAkhirSiswa(komponen, baris, "s1");
    expect(hasil).toEqual({ lengkap: true, nilaiAkhir: 0 });
  });

  it("siswa tanpa satu baris pun dinyatakan belum lengkap, tanpa nilai akhir", () => {
    const komponen = TEMPLAT.map((k, i) => ({ id: `k${i}`, kode: k.kode, bobot: k.bobot }));
    const hasil = bentukNilaiAkhirSiswa(komponen, [], "s1");
    expect(hasil).toEqual({ lengkap: false, nilaiAkhir: null });
  });
});
