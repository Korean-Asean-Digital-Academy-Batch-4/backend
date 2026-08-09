import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";

import { UMUR_SESI_MS } from "../../src/domain/sesi.js";
import {
  buatSesi,
  cabutSeluruhSesi,
  cabutSesi,
  cariSesiSah,
  hashToken,
} from "../../src/db/sesi.js";
import { poolPemilik, tutupPool } from "./bantuan.js";

// CK-A-04: sesi berupa baris di basis data yang dapat dicabut, dan pencabutan
// berlaku SEKETIKA pada request berikutnya. CK-S-06: yang tersimpan adalah
// hash token, bukan tokennya.

const b = inject("benih");
const SEKARANG = new Date("2026-08-08T07:00:00+07:00");

afterAll(tutupPool);

beforeEach(async () => {
  await poolPemilik().query(`DELETE FROM sesi_masuk`);
});

describe("CK-S-06 — yang tersimpan adalah hash, bukan tokennya", () => {
  it("tidak menyimpan token di kolom mana pun", async () => {
    const { token } = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);

    const hasil = await poolPemilik().query<{ token_hash: string }>(
      `SELECT token_hash FROM sesi_masuk`,
    );

    expect(hasil.rows).toHaveLength(1);
    expect(hasil.rows[0]?.token_hash).not.toBe(token);
    expect(hasil.rows[0]?.token_hash).toBe(hashToken(token));
    expect(hasil.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("menghasilkan token yang tidak pernah sama", async () => {
    const banyak = await Promise.all(
      Array.from({ length: 20 }, () => buatSesi(poolPemilik(), b.guruBio, SEKARANG)),
    );

    expect(new Set(banyak.map((s) => s.token)).size).toBe(20);
  });
});

describe("umur sesi 12 jam tanpa perpanjangan", () => {
  it("menyimpan kedaluwarsa 12 jam sesudah dibuat", async () => {
    const { kedaluwarsaPada } = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);

    expect(kedaluwarsaPada.getTime() - SEKARANG.getTime()).toBe(UMUR_SESI_MS);
  });

  it("mengenali sesi yang masih berlaku", async () => {
    const { token } = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);

    const sesi = await cariSesiSah(poolPemilik(), token, SEKARANG);

    expect(sesi?.penggunaRef).toBe(b.guruBio);
    expect(sesi?.peran).toBe("guru");
  });

  it("menolak sesi yang sudah kedaluwarsa", async () => {
    const { token } = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);
    const besok = new Date(SEKARANG.getTime() + UMUR_SESI_MS + 1);

    expect(await cariSesiSah(poolPemilik(), token, besok)).toBeNull();
  });

  it("tidak memperpanjang sesi ketika dipakai", async () => {
    const { token, kedaluwarsaPada } = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);
    const setengahJalan = new Date(SEKARANG.getTime() + UMUR_SESI_MS / 2);

    await cariSesiSah(poolPemilik(), token, setengahJalan);

    const hasil = await poolPemilik().query<{ kedaluwarsa_pada: Date }>(
      `SELECT kedaluwarsa_pada FROM sesi_masuk WHERE token_hash = $1`,
      [hashToken(token)],
    );
    expect(hasil.rows[0]?.kedaluwarsa_pada).toEqual(kedaluwarsaPada);
  });

  it("menolak token yang tidak pernah ada", async () => {
    expect(await cariSesiSah(poolPemilik(), "token-karangan", SEKARANG)).toBeNull();
  });
});

describe("pencabutan berlaku seketika — CK-A-04", () => {
  it("menolak sesi tepat sesudah dicabut", async () => {
    const { token } = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);
    expect(await cariSesiSah(poolPemilik(), token, SEKARANG)).not.toBeNull();

    await cabutSesi(poolPemilik(), token);

    expect(await cariSesiSah(poolPemilik(), token, SEKARANG)).toBeNull();
  });

  it("mencabut seluruh sesi milik satu pengguna", async () => {
    const satu = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);
    const dua = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);
    const lain = await buatSesi(poolPemilik(), b.guruFis, SEKARANG);

    await cabutSeluruhSesi(poolPemilik(), b.guruBio);

    expect(await cariSesiSah(poolPemilik(), satu.token, SEKARANG)).toBeNull();
    expect(await cariSesiSah(poolPemilik(), dua.token, SEKARANG)).toBeNull();
    expect(await cariSesiSah(poolPemilik(), lain.token, SEKARANG)).not.toBeNull();
  });

  it("mempertahankan satu sesi yang dikecualikan — API sec 3.2", async () => {
    const dipakai = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);
    const lama = await buatSesi(poolPemilik(), b.guruBio, SEKARANG);

    await cabutSeluruhSesi(poolPemilik(), b.guruBio, dipakai.token);

    expect(await cariSesiSah(poolPemilik(), dipakai.token, SEKARANG)).not.toBeNull();
    expect(await cariSesiSah(poolPemilik(), lama.token, SEKARANG)).toBeNull();
  });

  it("ikut terhapus ketika penggunanya dihapus", async () => {
    await buatSesi(poolPemilik(), b.guruTanpaMapel, SEKARANG);

    const klien = await poolPemilik().connect();
    try {
      await klien.query("BEGIN");
      await klien.query(`DELETE FROM guru WHERE pengguna_ref = $1`, [b.guruTanpaMapel]);
      await klien.query(`DELETE FROM pengguna WHERE id = $1`, [b.guruTanpaMapel]);
      const sisa = await klien.query<{ jumlah: string }>(
        `SELECT count(*)::text AS jumlah FROM sesi_masuk WHERE pengguna_ref = $1`,
        [b.guruTanpaMapel],
      );
      expect(sisa.rows[0]?.jumlah).toBe("0");
    } finally {
      await klien.query("ROLLBACK");
      klien.release();
    }
  });
});
