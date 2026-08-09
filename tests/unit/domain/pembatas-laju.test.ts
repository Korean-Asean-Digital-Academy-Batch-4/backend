import { describe, expect, it } from "vitest";

import {
  BATAS_MASUK,
  JENDELA_MASUK_MS,
  awalJendela,
  bolehMencoba,
  cobaLagiPada,
} from "../../../src/domain/pembatas-laju.js";

// ARCHITECTURE.md Pasal 7: 5 percobaan GAGAL per 15 menit, dihitung per akun
// DAN per alamat IP. Relevan karena PRD sec 6.1.3 meniadakan syarat kerumitan
// kata sandi, sehingga pembatasan percobaan adalah pertahanan yang tersisa.

const SEKARANG = new Date("2026-08-08T14:37:23+07:00");

describe("batas dan jendela", () => {
  it("membatasi 5 percobaan per 15 menit", () => {
    expect(BATAS_MASUK).toBe(5);
    expect(JENDELA_MASUK_MS).toBe(15 * 60 * 1000);
  });
});

describe("awalJendela", () => {
  it("membulatkan ke bawah ke kelipatan jendela", () => {
    // 14:37:23 jatuh pada jendela 14:30:00
    expect(awalJendela(SEKARANG, JENDELA_MASUK_MS)).toEqual(new Date("2026-08-08T14:30:00+07:00"));
  });

  it("menempatkan dua momen dalam satu jendela pada awal yang sama", () => {
    const awal = awalJendela(new Date("2026-08-08T14:30:00+07:00"), JENDELA_MASUK_MS);
    const akhir = awalJendela(new Date("2026-08-08T14:44:59+07:00"), JENDELA_MASUK_MS);

    expect(awal).toEqual(akhir);
  });

  it("memindahkan momen sesudahnya ke jendela berikutnya", () => {
    expect(awalJendela(new Date("2026-08-08T14:45:00+07:00"), JENDELA_MASUK_MS)).toEqual(
      new Date("2026-08-08T14:45:00+07:00"),
    );
  });
});

describe("bolehMencoba", () => {
  it("mengizinkan sampai percobaan kelima", () => {
    for (const jumlah of [0, 1, 2, 3, 4]) {
      expect(bolehMencoba(jumlah, BATAS_MASUK)).toBe(true);
    }
  });

  it("menolak sejak percobaan kelima sudah tercatat", () => {
    expect(bolehMencoba(BATAS_MASUK, BATAS_MASUK)).toBe(false);
    expect(bolehMencoba(BATAS_MASUK + 1, BATAS_MASUK)).toBe(false);
  });
});

describe("cobaLagiPada", () => {
  it("menunjuk awal jendela berikutnya", () => {
    expect(cobaLagiPada(SEKARANG, JENDELA_MASUK_MS)).toEqual(new Date("2026-08-08T14:45:00+07:00"));
  });

  it("selalu berada di depan momen yang diberikan", () => {
    for (const menit of ["14:30:00", "14:37:23", "14:44:59"]) {
      const momen = new Date(`2026-08-08T${menit}+07:00`);
      expect(cobaLagiPada(momen, JENDELA_MASUK_MS).getTime()).toBeGreaterThan(momen.getTime());
    }
  });
});
