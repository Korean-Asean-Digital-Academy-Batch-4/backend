import { describe, expect, it } from "vitest";

import {
  STATUS_PRESENSI,
  hitungPersentaseKehadiran,
  terhitungHadir,
  type StatusPresensi,
} from "../../../src/domain/presensi.js";

// I-17 dan I-18 adalah gerbang A3, dan keduanya TIDAK ditegakkan basis data
// (SCHEMA.md sec 5.1). Berkas ini satu-satunya penjaganya.
//
// PRD sec 8.4:
//   Persentase = jumlah sesi Hadir, Izin, atau Sakit ÷ jumlah sesi dibuka × 100%

function sesi(...status: StatusPresensi[]): StatusPresensi[] {
  return status;
}

describe("I-17 Izin dan Sakit terhitung sebagai kehadiran", () => {
  it("menghitung hadir, izin, dan sakit sebagai kehadiran", () => {
    expect(terhitungHadir("hadir")).toBe(true);
    expect(terhitungHadir("izin")).toBe(true);
    expect(terhitungHadir("sakit")).toBe(true);
  });

  it("hanya alpa yang mengurangi persentase — P16 dan AC-29", () => {
    expect(terhitungHadir("alpa")).toBe(false);
  });

  it("menghasilkan 100 persen ketika seluruhnya izin", () => {
    const hasil = hitungPersentaseKehadiran(sesi("izin", "izin", "izin", "izin"));

    expect(hasil).toEqual({ adaSesi: true, persen: 100 });
  });

  it("menghasilkan 100 persen ketika seluruhnya sakit", () => {
    const hasil = hitungPersentaseKehadiran(sesi("sakit", "sakit"));

    expect(hasil).toEqual({ adaSesi: true, persen: 100 });
  });

  it("menyamakan izin dan sakit dengan hadir pada campuran", () => {
    const campuran = hitungPersentaseKehadiran(sesi("hadir", "izin", "sakit", "alpa"));
    const seluruhnyaHadir = hitungPersentaseKehadiran(sesi("hadir", "hadir", "hadir", "alpa"));

    expect(campuran).toEqual(seluruhnyaHadir);
    expect(campuran).toEqual({ adaSesi: true, persen: 75 });
  });

  it("menghasilkan 0 persen ketika seluruhnya alpa", () => {
    expect(hitungPersentaseKehadiran(sesi("alpa", "alpa"))).toEqual({ adaSesi: true, persen: 0 });
  });
});

describe("I-18 penyebutnya adalah jumlah sesi yang dibuka", () => {
  it("memakai jumlah seluruh sesi sebagai penyebut, bukan jumlah yang hadir", () => {
    // 3 dari 4 sesi terhitung hadir
    expect(hitungPersentaseKehadiran(sesi("hadir", "hadir", "izin", "alpa"))).toEqual({
      adaSesi: true,
      persen: 75,
    });
  });

  it("berubah ketika satu sesi dihapus — AC-25", () => {
    const sebelum = hitungPersentaseKehadiran(sesi("hadir", "hadir", "alpa", "alpa"));
    const sesudah = hitungPersentaseKehadiran(sesi("hadir", "hadir", "alpa"));

    expect(sebelum).toEqual({ adaSesi: true, persen: 50 });
    expect(sesudah).toEqual({ adaSesi: true, persen: 66.67 });
  });

  it("menyatakan tidak ada sesi alih-alih membagi dengan nol", () => {
    expect(hitungPersentaseKehadiran([])).toEqual({ adaSesi: false });
  });

  it("membulatkan ke dua desimal — API sec 2.4", () => {
    // 1 dari 3 → 33,333…
    expect(hitungPersentaseKehadiran(sesi("hadir", "alpa", "alpa"))).toEqual({
      adaSesi: true,
      persen: 33.33,
    });
  });

  it("membulatkan setengah ke atas", () => {
    // 5 dari 8 → 62,5
    const delapan = sesi("hadir", "hadir", "hadir", "hadir", "hadir", "alpa", "alpa", "alpa");

    expect(hitungPersentaseKehadiran(delapan)).toEqual({ adaSesi: true, persen: 62.5 });
  });

  it("menghitung satu sesi tunggal", () => {
    expect(hitungPersentaseKehadiran(sesi("hadir"))).toEqual({ adaSesi: true, persen: 100 });
    expect(hitungPersentaseKehadiran(sesi("alpa"))).toEqual({ adaSesi: true, persen: 0 });
  });
});

describe("himpunan status tertutup", () => {
  it("memuat tepat empat status sesuai ck_presensi_status", () => {
    expect(STATUS_PRESENSI).toEqual(["hadir", "izin", "sakit", "alpa"]);
  });
});
