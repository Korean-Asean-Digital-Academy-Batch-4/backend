import { afterAll, describe, expect, it } from "vitest";

import { buatKataSandiAwal, kataSandiArgon2id } from "../../src/adapters/local/kata-sandi.js";
import { buatAdministrator, gantiKataSandi } from "../../src/db/administrator.js";
import { poolPemilik, tutupPool } from "./bantuan.js";

// ARCHITECTURE.md sec 9.3: akun Administrator dibuat langsung ke basis data
// lewat CLI, bukan lewat antarmuka aplikasi. Menutup T-03 pada RFC-001 sec 10.

const kataSandi = kataSandiArgon2id();

afterAll(tutupPool);

describe("buatAdministrator", () => {
  it("membuat akun berperan administrator beserta kata sandi acak", async () => {
    const hasil = await buatAdministrator(
      poolPemilik(),
      kataSandi,
      "kepsek",
      "Kepala Sekolah",
      buatKataSandiAwal(),
    );

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
    const hasil = await buatAdministrator(
      poolPemilik(),
      kataSandi,
      "kepsek2",
      "Kepala Dua",
      buatKataSandiAwal(),
    );
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
    const hasil = await buatAdministrator(
      poolPemilik(),
      kataSandi,
      "admin",
      "Administrator Kedua",
      buatKataSandiAwal(),
    );

    expect(hasil.berhasil).toBe(false);
    if (hasil.berhasil) return;
    expect(hasil.sebab).toContain("sudah dipakai");
  });

  it("menolak nama pengguna yang hanya berbeda huruf besar-kecil", async () => {
    const hasil = await buatAdministrator(
      poolPemilik(),
      kataSandi,
      "ADMIN",
      "Administrator Kedua",
      buatKataSandiAwal(),
    );

    expect(hasil.berhasil).toBe(false);
  });

  it("menghasilkan kata sandi berbeda pada setiap pemanggilan", async () => {
    const satu = await buatAdministrator(
      poolPemilik(),
      kataSandi,
      "kepsek3",
      "Tiga",
      buatKataSandiAwal(),
    );
    const dua = await buatAdministrator(
      poolPemilik(),
      kataSandi,
      "kepsek4",
      "Empat",
      buatKataSandiAwal(),
    );

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
    // Dipulihkan tangan, bukan lewat transaksi: gantiKataSandi memakai koneksi
    // sendiri dari pool, sehingga transaksi pada koneksi lain tidak membatalkannya.
    const sebelum = await poolPemilik().query<{ kata_sandi_hash: string }>(
      `SELECT kata_sandi_hash FROM pengguna WHERE nama_pengguna = 'admin'`,
    );
    const semula = sebelum.rows[0]!.kata_sandi_hash;

    try {
      const hasil = await gantiKataSandi(poolPemilik(), kataSandi, "admin", buatKataSandiAwal());

      expect(hasil.berhasil).toBe(true);
      if (!hasil.berhasil) return;

      const baris = await poolPemilik().query<{ kata_sandi_hash: string }>(
        `SELECT kata_sandi_hash FROM pengguna WHERE nama_pengguna = 'admin'`,
      );
      expect(await kataSandi.verifikasi(baris.rows[0]!.kata_sandi_hash, hasil.kataSandiAwal)).toBe(
        true,
      );
    } finally {
      await poolPemilik().query(
        `UPDATE pengguna SET kata_sandi_hash = $1 WHERE nama_pengguna = 'admin'`,
        [semula],
      );
    }
  });

  it("menolak nama pengguna yang tidak ada", async () => {
    const hasil = await gantiKataSandi(poolPemilik(), kataSandi, "tidak-ada", buatKataSandiAwal());

    expect(hasil.berhasil).toBe(false);
    if (hasil.berhasil) return;
    expect(hasil.sebab).toContain("tidak ditemukan");
  });
});

describe("CK-A-09 — kata sandi yang ditentukan operator", () => {
  it("memakai kata sandi yang diberikan, bukan membangkitkan sendiri", async () => {
    const pilihan = "kata sandi pilihan operator";
    const hasil = await buatAdministrator(
      poolPemilik(),
      kataSandi,
      "kepsek5",
      "Kepala Lima",
      pilihan,
    );

    try {
      expect(hasil.berhasil).toBe(true);
      if (!hasil.berhasil) return;
      expect(hasil.kataSandiAwal).toBe(pilihan);

      const baris = await poolPemilik().query<{ kata_sandi_hash: string }>(
        `SELECT kata_sandi_hash FROM pengguna WHERE id = $1`,
        [hasil.id],
      );
      expect(await kataSandi.verifikasi(baris.rows[0]!.kata_sandi_hash, pilihan)).toBe(true);
    } finally {
      await poolPemilik().query(`DELETE FROM pengguna WHERE nama_pengguna = 'kepsek5'`);
    }
  });

  it("menerima kata sandi tanpa syarat kerumitan — PRD sec 6.1.3", async () => {
    const hasil = await buatAdministrator(poolPemilik(), kataSandi, "kepsek6", "Kepala Enam", "a");

    try {
      expect(hasil.berhasil).toBe(true);
    } finally {
      await poolPemilik().query(`DELETE FROM pengguna WHERE nama_pengguna = 'kepsek6'`);
    }
  });
});
