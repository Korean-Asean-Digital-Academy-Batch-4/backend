import { afterAll, describe, expect, inject, it } from "vitest";

import { dalamTransaksiBatal, harusDitolak, poolPemilik, tutupPool } from "./bantuan.js";

// I-01 sampai I-11 pada RFC-001 sec 6, dengan cara penegakan pada SCHEMA.md sec 5.1.
// Setiap tes berbentuk pernyataan yang WAJIB gagal — AGENTS.md sec 4.2.

const b = inject("benih");

afterAll(tutupPool);

describe("I-01 satu pengguna satu peran", () => {
  it("menolak peran di luar ketiganya", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
           VALUES ('kepsek', 'Kepala Sekolah', 'kepala_sekolah', 'x')`,
        ),
      ),
    );

    expect(tolak.constraint).toBe("ck_pengguna_peran");
  });

  it("menolak baris guru bagi pengguna berperan siswa", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(`INSERT INTO guru (pengguna_ref) VALUES ($1)`, [b.siswaAndi]),
      ),
    );

    expect(tolak.constraint).toBe("fk_guru_pengguna");
  });

  it("menolak baris siswa bagi pengguna berperan guru", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(`INSERT INTO siswa (pengguna_ref) VALUES ($1)`, [b.guruBio]),
      ),
    );

    expect(tolak.constraint).toBe("fk_siswa_pengguna");
  });
});

describe("I-02 pengenal masuk unik lintas seluruh pengguna", () => {
  it("menolak nama pengguna yang sama", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
           VALUES ('admin', 'Administrator Kedua', 'administrator', 'x')`,
        ),
      ),
    );

    expect(tolak.pesan).toContain("uq_pengguna_nama_pengguna");
  });

  it("menolak yang hanya berbeda huruf besar-kecil", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
           VALUES ('Admin', 'Administrator Kedua', 'administrator', 'x')`,
        ),
      ),
    );

    expect(tolak.pesan).toContain("uq_pengguna_nama_pengguna");
  });
});

describe("I-03 satu semester aktif per tahun ajaran", () => {
  it("menolak semester kedua yang ikut aktif", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(`UPDATE periode SET aktif = true WHERE id = $1`, [b.periodeGenap]),
      ),
    );

    expect(tolak.pesan).toContain("uq_periode_aktif_per_tahun");
  });

  it("menerima perpindahan semester aktif dalam satu transaksi", async () => {
    await dalamTransaksiBatal(async (k) => {
      await k.query(`UPDATE periode SET aktif = false WHERE id = $1`, [b.periodeGanjil]);
      await k.query(`UPDATE periode SET aktif = true WHERE id = $1`, [b.periodeGenap]);
    });
  });
});

describe("I-04 mapel melekat pada tepat satu jenjang dan satu guru", () => {
  it("menolak mapel tanpa jenjang", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO mapel (kode, nama, tingkat, guru_ref) VALUES ('KIM', 'Kimia', NULL, $1)`,
          [b.guruTanpaMapel],
        ),
      ),
    );

    expect(tolak.pesan).toContain("tingkat");
  });

  it("menolak mapel tanpa guru pengampu", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO mapel (kode, nama, tingkat, guru_ref) VALUES ('KIM', 'Kimia', 'X', NULL)`,
        ),
      ),
    );

    expect(tolak.pesan).toContain("guru_ref");
  });
});

describe("I-05 satu guru mengampu paling banyak satu mapel", () => {
  it("menolak mapel kedua bagi guru yang sama", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO mapel (kode, nama, tingkat, guru_ref) VALUES ('KIM', 'Kimia', 'X', $1)`,
          [b.guruBio],
        ),
      ),
    );

    expect(tolak.constraint).toBe("uq_mapel_guru");
  });
});

describe("I-06 jenjang kelas sama dengan jenjang mapel — AC-24", () => {
  it("menolak kelas jenjang X dihubungkan dengan mapel jenjang XI", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO penugasan (guru_ref, mapel_ref, kelas_ref, tingkat)
           VALUES ($1, $2, $3, 'XI')`,
          [b.guruFis, b.mapelFis, b.kelasX1],
        ),
      ),
    );

    expect(tolak.constraint).toBe("fk_penugasan_kelas_tingkat");
  });

  it("menolak jenjang yang tidak cocok dengan mapelnya", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO penugasan (guru_ref, mapel_ref, kelas_ref, tingkat)
           VALUES ($1, $2, $3, 'X')`,
          [b.guruFis, b.mapelFis, b.kelasX1],
        ),
      ),
    );

    expect(tolak.constraint).toBe("fk_penugasan_mapel_tingkat");
  });
});

describe("I-07 satu mapel pada satu kelas diajar satu guru", () => {
  // Dipasang pada XI-1 yang belum memiliki penugasan apa pun, supaya yang
  // menolak benar-benar fk_penugasan_mapel_guru dan bukan uq_penugasan_kelas_mapel.
  it("menolak penugasan yang gurunya bukan pengampu mapelnya", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO penugasan (guru_ref, mapel_ref, kelas_ref, tingkat)
           VALUES ($1, $2, $3, 'XI')`,
          [b.guruTanpaMapel, b.mapelFis, b.kelasXi1],
        ),
      ),
    );

    expect(tolak.constraint).toBe("fk_penugasan_mapel_guru");
  });

  it("menolak mapel yang sama diberikan dua kali pada satu kelas", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO penugasan (guru_ref, mapel_ref, kelas_ref, tingkat)
           VALUES ($1, $2, $3, 'X')`,
          [b.guruBio, b.mapelBio, b.kelasX1],
        ),
      ),
    );

    expect(tolak.constraint).toBe("uq_penugasan_kelas_mapel");
  });
});

describe("I-08 satu siswa satu kelas per semester — T-02", () => {
  it("menolak siswa yang sama masuk kelas kedua pada periode yang sama", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(`INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES ($1, $2, $3)`, [
          b.kelasXi1,
          b.siswaAndi,
          b.periodeGanjil,
        ]),
      ),
    );

    expect(tolak.constraint).toBe("uq_kelas_siswa_periode");
  });

  it("menolak periode yang menyimpang dari periode kelasnya", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(`INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES ($1, $2, $3)`, [
          b.kelasX1,
          b.siswaBudi,
          b.periodeGenap,
        ]),
      ),
    );

    expect(tolak.constraint).toBe("fk_kelas_siswa_kelas");
  });
});

describe("I-09 satu kelas paling banyak satu wali — S-02", () => {
  it("menolak guru yang sama menjadi wali dua kelas pada satu periode", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(`UPDATE kelas SET wali_kelas_ref = $1 WHERE id = $2`, [b.guruBio, b.kelasXi1]),
      ),
    );

    expect(tolak.pesan).toContain("uq_kelas_wali_per_periode");
  });
});

describe("I-10 jumlah bobot komponen tepat 100 — AC-04", () => {
  it("menolak keadaan akhir transaksi yang jumlahnya bukan 100", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        await k.query(`UPDATE komponen_penilaian SET bobot = bobot + 4 WHERE kode = 'T1'`);
        await k.query("SET CONSTRAINTS ALL IMMEDIATE");
      }),
    );

    expect(tolak.pesan).toContain("104");
  });

  it("menerima penyesuaian yang saling menutup di dalam satu transaksi", async () => {
    await dalamTransaksiBatal(async (k) => {
      await k.query(`UPDATE komponen_penilaian SET bobot = bobot + 4 WHERE kode = 'T1'`);
      await k.query(`UPDATE komponen_penilaian SET bobot = bobot - 4 WHERE kode = 'T2'`);
      await k.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
  });

  it("menolak penghapusan satu komponen tanpa penyesuaian", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        // Snapshot penugasan (dipasang fixture A6 dari templat yang sama) FK-
        // merantai komponen benih; tanpa melepasnya lebih dulu, DELETE di bawah
        // gagal FK dan tidak pernah mencapai trg_komponen_bobot yang diuji.
        // Pelepasan ikut batal bersama transaksi ini.
        await k.query(`DELETE FROM penugasan_komponen WHERE true`);
        await k.query(`DELETE FROM komponen_penilaian WHERE kode = 'T3'`);
        await k.query("SET CONSTRAINTS ALL IMMEDIATE");
      }),
    );

    expect(tolak.pesan).toContain("94");
  });
});

describe("I-11 KKM bernilai awal 75 — AC-22", () => {
  it("memberi nilai bawaan 75 ketika tidak disebutkan", async () => {
    const kkm = await dalamTransaksiBatal(async (k) => {
      const hasil = await k.query<{ kkm: number }>(
        `INSERT INTO mapel (kode, nama, tingkat, guru_ref) VALUES ('KIM', 'Kimia', 'X', $1)
         RETURNING kkm`,
        [b.guruTanpaMapel],
      );
      return hasil.rows[0]?.kkm;
    });

    expect(kkm).toBe(75);
  });

  it("menolak KKM di luar rentang 0 sampai 100", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) => k.query(`UPDATE mapel SET kkm = 101 WHERE id = $1`, [b.mapelBio])),
    );

    expect(tolak.constraint).toBe("ck_mapel_kkm");
  });
});

describe("benih tidak berubah setelah seluruh tes berjalan", () => {
  it("jumlah bobot komponen tetap 100", async () => {
    const hasil = await poolPemilik().query<{ total: string }>(
      `SELECT sum(bobot)::text AS total FROM komponen_penilaian`,
    );

    expect(hasil.rows[0]?.total).toBe("100");
  });
});
