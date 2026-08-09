import { afterAll, describe, expect, inject, it } from "vitest";

import { cariPenggunaUntukMasuk, muatKonteksPengguna } from "../../src/db/akun.js";
import { poolPemilik, tutupPool } from "./bantuan.js";

// API.md sec 3.1: respons masuk menyertakan penugasan dan wali_kelas, karena
// keduanya menentukan menu yang boleh tampil (UC-01). wali_kelas yang kosong
// adalah satu-satunya penanda menu finalisasi tidak boleh dirender (CK-A-01).

const b = inject("benih");

afterAll(tutupPool);

describe("pencarian akun untuk masuk", () => {
  it("menemukan pengguna beserta hash kata sandinya", async () => {
    const akun = await cariPenggunaUntukMasuk(poolPemilik(), "198001011001");

    expect(akun?.id).toBe(b.guruBio);
    expect(akun?.peran).toBe("guru");
    expect(akun?.kataSandiHash).toBe("x");
  });

  it("tidak peka huruf besar-kecil — I-02", async () => {
    const akun = await cariPenggunaUntukMasuk(poolPemilik(), "ADMIN");

    expect(akun?.id).toBe(b.admin);
  });

  it("mengembalikan null untuk nama pengguna yang tidak ada", async () => {
    expect(await cariPenggunaUntukMasuk(poolPemilik(), "tidak-ada")).toBeNull();
  });

  it("tetap mengembalikan akun nonaktif, supaya rute yang menolaknya", async () => {
    const klien = await poolPemilik().connect();
    try {
      await klien.query("BEGIN");
      await klien.query(`UPDATE pengguna SET aktif = false WHERE id = $1`, [b.guruFis]);
      const hasil = await klien.query<{ aktif: boolean }>(
        `SELECT aktif FROM pengguna WHERE id = $1`,
        [b.guruFis],
      );
      expect(hasil.rows[0]?.aktif).toBe(false);
    } finally {
      await klien.query("ROLLBACK");
      klien.release();
    }

    const akun = await cariPenggunaUntukMasuk(poolPemilik(), "198001011002");
    expect(akun).not.toBeNull();
    expect(akun?.aktif).toBe(true);
  });
});

describe("konteks pengguna sesudah masuk", () => {
  it("menyertakan penugasan Guru beserta nama kelas dan mapelnya", async () => {
    const konteks = await muatKonteksPengguna(poolPemilik(), b.guruBio);

    expect(konteks.penugasan).toEqual([
      { id: b.penugasanBioX1, kelasNama: "X-1", mapelNama: "Biologi" },
    ]);
  });

  it("menyertakan kelas yang diwalikan", async () => {
    const konteks = await muatKonteksPengguna(poolPemilik(), b.guruBio);

    expect(konteks.waliKelas).toEqual([{ kelasRef: b.kelasX1, kelasNama: "X-1" }]);
  });

  it("mengembalikan wali_kelas kosong bagi Guru yang bukan wali — CK-A-01", async () => {
    const konteks = await muatKonteksPengguna(poolPemilik(), b.guruFis);

    expect(konteks.waliKelas).toEqual([]);
  });

  it("mengembalikan keduanya kosong bagi Guru tanpa penugasan", async () => {
    const konteks = await muatKonteksPengguna(poolPemilik(), b.guruTanpaMapel);

    expect(konteks).toEqual({ penugasan: [], waliKelas: [] });
  });

  it("mengembalikan keduanya kosong bagi Administrator dan Siswa", async () => {
    for (const pengguna of [b.admin, b.siswaAndi]) {
      expect(await muatKonteksPengguna(poolPemilik(), pengguna)).toEqual({
        penugasan: [],
        waliKelas: [],
      });
    }
  });
});
