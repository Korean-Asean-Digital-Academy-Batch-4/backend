import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";

import { BATAS_MASUK, JENDELA_MASUK_MS } from "../../src/domain/pembatas-laju.js";
import { catatKegagalan, hapusPenghitung, periksaBatas } from "../../src/db/pembatas-laju.js";
import { poolPemilik, tutupPool } from "./bantuan.js";

// ARCHITECTURE.md Pasal 7 dan CK-A-03: penghitung disimpan di PostgreSQL, bukan
// di memori proses, supaya batas tetap berlaku meskipun setiap instance Lambda
// memiliki memorinya sendiri.

const b = inject("benih");
const SEKARANG = new Date("2026-08-08T14:37:23+07:00");
const kunci = `login:pengguna:${b.guruBio}`;

afterAll(tutupPool);

beforeEach(async () => {
  await poolPemilik().query(`DELETE FROM pembatas_laju`);
});

async function gagalSebanyak(n: number, pada = SEKARANG): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await catatKegagalan(poolPemilik(), kunci, pada, JENDELA_MASUK_MS);
  }
}

describe("batas 5 percobaan gagal per 15 menit", () => {
  it("mengizinkan ketika belum ada kegagalan sama sekali", async () => {
    const hasil = await periksaBatas(poolPemilik(), kunci, SEKARANG, BATAS_MASUK, JENDELA_MASUK_MS);

    expect(hasil.boleh).toBe(true);
  });

  it("masih mengizinkan sesudah empat kegagalan", async () => {
    await gagalSebanyak(4);

    const hasil = await periksaBatas(poolPemilik(), kunci, SEKARANG, BATAS_MASUK, JENDELA_MASUK_MS);

    expect(hasil.boleh).toBe(true);
  });

  it("menolak sesudah kegagalan kelima", async () => {
    await gagalSebanyak(5);

    const hasil = await periksaBatas(poolPemilik(), kunci, SEKARANG, BATAS_MASUK, JENDELA_MASUK_MS);

    expect(hasil.boleh).toBe(false);
  });

  it("menyebutkan kapan dapat dicoba kembali — API sec 10", async () => {
    await gagalSebanyak(5);

    const hasil = await periksaBatas(poolPemilik(), kunci, SEKARANG, BATAS_MASUK, JENDELA_MASUK_MS);

    expect(hasil.boleh).toBe(false);
    if (hasil.boleh) return;
    expect(hasil.cobaLagiPada).toEqual(new Date("2026-08-08T14:45:00+07:00"));
  });

  it("membuka kembali pada jendela berikutnya", async () => {
    await gagalSebanyak(5);
    const jendelaBerikutnya = new Date("2026-08-08T14:45:01+07:00");

    const hasil = await periksaBatas(
      poolPemilik(),
      kunci,
      jendelaBerikutnya,
      BATAS_MASUK,
      JENDELA_MASUK_MS,
    );

    expect(hasil.boleh).toBe(true);
  });
});

describe("penghitung terpisah per kunci", () => {
  it("tidak mencampur batas antar akun maupun antar alamat IP", async () => {
    await gagalSebanyak(5);

    const lain = await periksaBatas(
      poolPemilik(),
      "login:ip:203.0.113.7",
      SEKARANG,
      BATAS_MASUK,
      JENDELA_MASUK_MS,
    );

    expect(lain.boleh).toBe(true);
  });
});

describe("pembersihan tanpa pekerjaan latar — CK-07", () => {
  it("menghapus jendela lama pada penulisan berikutnya", async () => {
    await gagalSebanyak(3);
    await catatKegagalan(
      poolPemilik(),
      kunci,
      new Date("2026-08-08T15:02:00+07:00"),
      JENDELA_MASUK_MS,
    );

    const hasil = await poolPemilik().query<{ jumlah: string }>(
      `SELECT count(*)::text AS jumlah FROM pembatas_laju WHERE kunci = $1`,
      [kunci],
    );

    expect(hasil.rows[0]?.jumlah).toBe("1");
  });
});

describe("penghapusan penghitung setelah berhasil masuk", () => {
  it("mengembalikan jatah penuh sesudah masuk berhasil", async () => {
    await gagalSebanyak(4);
    await hapusPenghitung(poolPemilik(), kunci);

    const hasil = await periksaBatas(poolPemilik(), kunci, SEKARANG, BATAS_MASUK, JENDELA_MASUK_MS);

    expect(hasil.boleh).toBe(true);
  });
});
