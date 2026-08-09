import { afterAll, describe, expect, it } from "vitest";

import { kataSandiArgon2id } from "../../src/adapters/local/kata-sandi.js";
import { buatAdministrator, gantiKataSandi } from "../../src/db/administrator.js";
import { poolPemilik, tutupPool } from "./bantuan.js";

// ARCHITECTURE.md sec 9.3: akun Administrator dibuat langsung ke basis data
// lewat CLI, bukan lewat antarmuka aplikasi. Menutup T-03 pada RFC-001 sec 10.

const kataSandi = kataSandiArgon2id();

afterAll(tutupPool);

async function dalamTransaksiBatal<T>(jalan: () => Promise<T>): Promise<T> {
  const klien = await poolPemilik().connect();
  try {
    await klien.query("BEGIN");
    return await jalan();
  } finally {
    await klien.query("ROLLBACK").catch(() => undefined);
    klien.release();
  }
}

describe("buatAdministrator", () => {
  it("membuat akun berperan administrator beserta kata sandi acak", async () => {
    const hasil = await buatAdministrator(poolPemilik(), kataSandi, "kepsek", "Kepala Sekolah");

    try {
      expect(hasil.berhasil).toBe(true);
      if (!hasil.berhasil) return;

      expect(hasil.kataSandiAwal).toHaveLength(12);

      const baris = await poolPemilik().query<{ peran: string; kata_sandi_hash: string }>(
        `SELECT peran, kata_sandi_hash FROM pengguna WHERE id = $1`,
        [hasil.id],
      );
      expect(baris.rows[0]?.peran).toBe("administrator");
      expect(baris.rows[0]?.kata_sandi_hash.startsWith("$argon2id$")).toBe(true);
      expect(await kataSandi.verifikasi(baris.rows[0]!.kata_sandi_hash, hasil.kataSandiAwal)).toBe(
        true,
      );
    } finally {
      await poolPemilik().query(`DELETE FROM pengguna WHERE nama_pengguna = 'kepsek'`);
    }
  });

  it("tidak membuat baris guru maupun siswa", async () => {
    const hasil = await buatAdministrator(poolPemilik(), kataSandi, "kepsek2", "Kepala Dua");
    try {
      if (!hasil.berhasil) return;
      const guru = await poolPemilik().query(`SELECT 1 FROM guru WHERE pengguna_ref = $1`, [
        hasil.id,
      ]);
      const siswa = await poolPemilik().query(`SELECT 1 FROM siswa WHERE pengguna_ref = $1`, [
        hasil.id,
      ]);
      expect(guru.rowCount).toBe(0);
      expect(siswa.rowCount).toBe(0);
    } finally {
      await poolPemilik().query(`DELETE FROM pengguna WHERE nama_pengguna = 'kepsek2'`);
    }
  });

  it("menolak nama pengguna yang sudah dipakai — I-02", async () => {
    const hasil = await buatAdministrator(poolPemilik(), kataSandi, "admin", "Administrator Kedua");

    expect(hasil.berhasil).toBe(false);
    if (hasil.berhasil) return;
    expect(hasil.sebab).toContain("sudah dipakai");
  });

  it("menolak nama pengguna yang hanya berbeda huruf besar-kecil", async () => {
    const hasil = await buatAdministrator(poolPemilik(), kataSandi, "ADMIN", "Administrator Kedua");

    expect(hasil.berhasil).toBe(false);
  });

  it("menghasilkan kata sandi berbeda pada setiap pemanggilan", async () => {
    const satu = await buatAdministrator(poolPemilik(), kataSandi, "kepsek3", "Tiga");
    const dua = await buatAdministrator(poolPemilik(), kataSandi, "kepsek4", "Empat");

    try {
      if (!satu.berhasil || !dua.berhasil) throw new Error("keduanya seharusnya berhasil");
      expect(satu.kataSandiAwal).not.toBe(dua.kataSandiAwal);
    } finally {
      await poolPemilik().query(
        `DELETE FROM pengguna WHERE nama_pengguna IN ('kepsek3', 'kepsek4')`,
      );
    }
  });
});

describe("gantiKataSandi", () => {
  it("mengganti kata sandi dan mencabut seluruh sesi pemiliknya", async () => {
    await dalamTransaksiBatal(async () => {
      const hasil = await gantiKataSandi(poolPemilik(), kataSandi, "admin");

      expect(hasil.berhasil).toBe(true);
      if (!hasil.berhasil) return;

      const baris = await poolPemilik().query<{ kata_sandi_hash: string }>(
        `SELECT kata_sandi_hash FROM pengguna WHERE nama_pengguna = 'admin'`,
      );
      expect(await kataSandi.verifikasi(baris.rows[0]!.kata_sandi_hash, hasil.kataSandiAwal)).toBe(
        true,
      );
    });
  });

  it("menolak nama pengguna yang tidak ada", async () => {
    const hasil = await gantiKataSandi(poolPemilik(), kataSandi, "tidak-ada");

    expect(hasil.berhasil).toBe(false);
    if (hasil.berhasil) return;
    expect(hasil.sebab).toContain("tidak ditemukan");
  });
});
