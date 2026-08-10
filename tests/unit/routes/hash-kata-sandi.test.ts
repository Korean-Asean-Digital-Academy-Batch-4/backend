import { describe, expect, it } from "vitest";

import type { KataSandi } from "../../../src/ports/kata-sandi.js";
import {
  hashKataSandiTerbatas,
  KONKURENSI_HASH_UNGGAH,
} from "../../../src/routes/administrasi/hash-kata-sandi.js";

function kataSandiTercatat(pilihan: { tolakPada?: string } = {}): {
  readonly kataSandi: KataSandi;
  readonly maksimumAktif: () => number;
} {
  let aktif = 0;
  let maksimum = 0;

  return {
    kataSandi: {
      buatAwal: () => "kata-sandi-awal",
      hash: async (polos) => {
        aktif += 1;
        maksimum = Math.max(maksimum, aktif);
        try {
          await new Promise((selesai) => setTimeout(selesai, 1));
          if (polos === pilihan.tolakPada) throw new Error("hash uji ditolak");
          return `hash:${polos}`;
        } finally {
          aktif -= 1;
        }
      },
      verifikasi: async () => false,
      verifikasiTiruan: async () => false,
    },
    maksimumAktif: () => maksimum,
  };
}

describe("hash kata sandi unggah terbatas", () => {
  it("menyelesaikan 360 hash dengan maksimum tepat empat pekerjaan aktif dan urutan tetap", async () => {
    const catatan = kataSandiTercatat();
    const input = Object.freeze(Array.from({ length: 360 }, (_, indeks) => `sandi-${indeks}`));

    const hasil = await hashKataSandiTerbatas(catatan.kataSandi, input);

    expect(KONKURENSI_HASH_UNGGAH).toBe(4);
    expect(catatan.maksimumAktif()).toBe(4);
    expect(hasil).toEqual(input.map((nilai) => `hash:${nilai}`));
  });

  it("menolak seluruh hasil ketika salah satu hash gagal", async () => {
    const catatan = kataSandiTercatat({ tolakPada: "rusak" });

    await expect(
      hashKataSandiTerbatas(catatan.kataSandi, ["satu", "dua", "rusak", "empat", "lima"]),
    ).rejects.toThrow("hash uji ditolak");
  });

  it("tetap menolak ketika alasan rejection bernilai undefined", async () => {
    const dasar = kataSandiTercatat().kataSandi;
    const kataSandi: KataSandi = {
      ...dasar,
      hash: async () => {
        throw undefined;
      },
    };
    let ditolak = false;

    try {
      await hashKataSandiTerbatas(kataSandi, ["rahasia"]);
    } catch (galat) {
      ditolak = true;
      expect(galat).toBeUndefined();
    }
    expect(ditolak).toBe(true);
  });
});
