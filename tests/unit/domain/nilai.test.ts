import { describe, expect, it } from "vitest";

import {
  hitungNilaiAkhir,
  periksaBobot,
  periksaKelengkapan,
  type Komponen,
  type NilaiKomponen,
} from "../../../src/domain/nilai.js";

// PRD sec 8.3: Nilai akhir = Σ (nilai komponen × bobot komponen) ÷ 100
// Salah hitung di sini berarti rapor siswa salah, dan tidak ada yang menangkapnya.

const TEMPLAT: Komponen[] = [
  { kode: "T1", bobot: 6 },
  { kode: "T2", bobot: 6 },
  { kode: "T3", bobot: 6 },
  { kode: "U1", bobot: 10 },
  { kode: "U2", bobot: 10 },
  { kode: "U3", bobot: 10 },
  { kode: "UTS", bobot: 26 },
  { kode: "UAS", bobot: 26 },
];

function seluruhnya(nilai: number): NilaiKomponen[] {
  return TEMPLAT.map((komponen) => ({ kode: komponen.kode, nilai }));
}

describe("periksaBobot — I-10 dan AC-04", () => {
  it("menerima templat bawaan yang berjumlah tepat 100", () => {
    expect(periksaBobot(TEMPLAT)).toEqual({ sah: true });
  });

  it("menolak jumlah di bawah 100 dan menyebutkan total saat ini", () => {
    const hasil = periksaBobot([
      { kode: "T1", bobot: 40 },
      { kode: "UAS", bobot: 50 },
    ]);

    expect(hasil.sah).toBe(false);
    if (hasil.sah) return;
    expect(hasil.total).toBe(90);
    expect(hasil.pesan).toContain("90");
  });

  it("menolak jumlah di atas 100 dan menyebutkan total saat ini", () => {
    const hasil = periksaBobot([
      { kode: "T1", bobot: 60 },
      { kode: "UAS", bobot: 50 },
    ]);

    expect(hasil.sah).toBe(false);
    if (hasil.sah) return;
    expect(hasil.total).toBe(110);
  });

  it("menolak daftar komponen kosong", () => {
    const hasil = periksaBobot([]);

    expect(hasil.sah).toBe(false);
    if (hasil.sah) return;
    expect(hasil.total).toBe(0);
  });
});

describe("periksaKelengkapan — I-12", () => {
  it("menyatakan lengkap ketika seluruh komponen terisi", () => {
    expect(periksaKelengkapan(TEMPLAT, seluruhnya(80))).toEqual({ lengkap: true });
  });

  it("menyebutkan komponen yang belum terisi, berurutan seperti templatnya", () => {
    const hasil = periksaKelengkapan(TEMPLAT, [
      { kode: "UAS", nilai: 90 },
      { kode: "T1", nilai: 80 },
    ]);

    expect(hasil).toEqual({ lengkap: false, kurang: ["T2", "T3", "U1", "U2", "U3", "UTS"] });
  });

  it("memperlakukan nilai nol sebagai terisi, bukan sebagai kosong", () => {
    expect(periksaKelengkapan(TEMPLAT, seluruhnya(0))).toEqual({ lengkap: true });
  });

  it("mengabaikan nilai atas komponen yang tidak ada pada templat", () => {
    const hasil = periksaKelengkapan(
      [{ kode: "T1", bobot: 100 }],
      [
        { kode: "T1", nilai: 80 },
        { kode: "SIKAP", nilai: 90 },
      ],
    );

    expect(hasil).toEqual({ lengkap: true });
  });
});

describe("hitungNilaiAkhir", () => {
  it("menolak menghitung selama data belum lengkap — PRD sec 8.3", () => {
    const hasil = hitungNilaiAkhir(TEMPLAT, [{ kode: "T1", nilai: 80 }]);

    expect(hasil.sah).toBe(false);
    if (hasil.sah) return;
    expect(hasil.sebab).toBe("komponen_belum_lengkap");
    if (hasil.sebab !== "komponen_belum_lengkap") return;
    expect(hasil.kurang).toHaveLength(7);
  });

  it("mengembalikan nilai yang sama ketika seluruh komponen bernilai sama", () => {
    const hasil = hitungNilaiAkhir(TEMPLAT, seluruhnya(80));

    expect(hasil).toEqual({ sah: true, nilaiAkhir: 80 });
  });

  it("membobot UTS dan UAS lebih besar daripada tugas", () => {
    const nilai = TEMPLAT.map((komponen) => ({
      kode: komponen.kode,
      nilai: komponen.kode === "UTS" || komponen.kode === "UAS" ? 90 : 60,
    }));

    // 6×3 + 10×3 = 48 bobot bernilai 60; 52 bobot bernilai 90
    // (48×60 + 52×90) ÷ 100 = (2880 + 4680) ÷ 100 = 75,60
    expect(hitungNilaiAkhir(TEMPLAT, nilai)).toEqual({ sah: true, nilaiAkhir: 75.6 });
  });

  it("menghitung pecahan tanpa selisih pembulatan biner", () => {
    const nilai = TEMPLAT.map((komponen, indeks) => ({
      kode: komponen.kode,
      nilai: indeks % 2 === 0 ? 70.35 : 82.15,
    }));

    // 48 bobot bernilai 70,35 dan 52 bobot bernilai 82,15
    // (48×70,35 + 52×82,15) ÷ 100 = (3376,80 + 4271,80) ÷ 100 = 76,486 → 76,49
    expect(hitungNilaiAkhir(TEMPLAT, nilai)).toEqual({ sah: true, nilaiAkhir: 76.49 });
  });

  it("membulatkan setengah ke atas pada desimal ketiga", () => {
    const komponen: Komponen[] = [
      { kode: "A", bobot: 50 },
      { kode: "B", bobot: 50 },
    ];
    const nilai: NilaiKomponen[] = [
      { kode: "A", nilai: 70 },
      { kode: "B", nilai: 80.01 },
    ];

    // (50×70 + 50×80,01) ÷ 100 = (3500 + 4000,50) ÷ 100 = 75,005 → 75,01
    expect(hitungNilaiAkhir(komponen, nilai)).toEqual({ sah: true, nilaiAkhir: 75.01 });
  });

  it("membulatkan ke bawah ketika desimal ketiga di bawah lima", () => {
    const komponen: Komponen[] = [
      { kode: "A", bobot: 33 },
      { kode: "B", bobot: 33 },
      { kode: "C", bobot: 34 },
    ];
    const nilai: NilaiKomponen[] = [
      { kode: "A", nilai: 70.01 },
      { kode: "B", nilai: 80.02 },
      { kode: "C", nilai: 90.03 },
    ];

    // (33×70,01 + 33×80,02 + 34×90,03) ÷ 100 = (2310,33 + 2640,66 + 3061,02) ÷ 100 = 80,1201
    expect(hitungNilaiAkhir(komponen, nilai)).toEqual({ sah: true, nilaiAkhir: 80.12 });
  });

  it("menghasilkan 0 ketika seluruh komponen bernilai nol", () => {
    expect(hitungNilaiAkhir(TEMPLAT, seluruhnya(0))).toEqual({ sah: true, nilaiAkhir: 0 });
  });

  it("menghasilkan 100 ketika seluruh komponen bernilai penuh", () => {
    expect(hitungNilaiAkhir(TEMPLAT, seluruhnya(100))).toEqual({ sah: true, nilaiAkhir: 100 });
  });

  it("menolak menghitung ketika jumlah bobotnya bukan 100", () => {
    const komponen: Komponen[] = [{ kode: "A", bobot: 50 }];
    const hasil = hitungNilaiAkhir(komponen, [{ kode: "A", nilai: 80 }]);

    expect(hasil.sah).toBe(false);
    if (hasil.sah) return;
    expect(hasil.sebab).toBe("bobot_tidak_seratus");
    if (hasil.sebab !== "bobot_tidak_seratus") return;
    expect(hasil.total).toBe(50);
    expect(hasil.pesan).toContain("50");
  });

  it("tidak membobot nilai atas komponen di luar templat", () => {
    const nilai = [...seluruhnya(80), { kode: "SIKAP", nilai: 20 }];

    expect(hitungNilaiAkhir(TEMPLAT, nilai)).toEqual({ sah: true, nilaiAkhir: 80 });
  });

  it("menghitung sekali saja ketika satu komponen muncul dua kali", () => {
    const nilai = [...seluruhnya(80), { kode: "UAS", nilai: 80 }];

    expect(hitungNilaiAkhir(TEMPLAT, nilai)).toEqual({ sah: true, nilaiAkhir: 80 });
  });

  it("memeriksa bobot lebih dahulu daripada kelengkapan", () => {
    const hasil = hitungNilaiAkhir([{ kode: "A", bobot: 50 }], []);

    expect(hasil.sah).toBe(false);
    if (hasil.sah) return;
    expect(hasil.sebab).toBe("bobot_tidak_seratus");
  });
});
