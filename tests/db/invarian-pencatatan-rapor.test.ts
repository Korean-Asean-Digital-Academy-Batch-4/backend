import type { PoolClient } from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";

import { dalamTransaksiBatal, harusDitolak, tutupPool } from "./bantuan.js";

// I-12 sampai I-21 pada RFC-001 sec 6. I-17, I-18, I-20, dan I-22 sengaja tidak
// ada di sini: keempatnya sepenuhnya milik lapisan aplikasi (SCHEMA.md sec 5.1)
// dan menjadi sasaran tahap A3 ke atas.

const b = inject("benih");

afterAll(tutupPool);

async function komponen(k: PoolClient, kode: string): Promise<string> {
  const hasil = await k.query<{ id: string }>(`SELECT id FROM komponen_penilaian WHERE kode = $1`, [
    kode,
  ]);
  const id = hasil.rows[0]?.id;
  if (!id) throw new Error(`Komponen ${kode} tidak ada pada data awal`);
  return id;
}

describe("I-12 nilai kosong terbedakan dari nol", () => {
  it("menolak baris nilai tanpa nilainya", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const t1 = await komponen(k, "T1");
        await k.query(
          `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
           VALUES ($1, $2, $3, NULL, $4)`,
          [b.penugasanBioX1, t1, b.siswaAndi, b.guruBio],
        );
      }),
    );

    expect(tolak.pesan).toContain("nilai");
  });

  it("menerima nilai nol sebagai nilai yang sah", async () => {
    const tersimpan = await dalamTransaksiBatal(async (k) => {
      const t1 = await komponen(k, "T1");
      const hasil = await k.query<{ nilai: string }>(
        `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
         VALUES ($1, $2, $3, 0, $4) RETURNING nilai`,
        [b.penugasanBioX1, t1, b.siswaAndi, b.guruBio],
      );
      return hasil.rows[0]?.nilai;
    });

    expect(tersimpan).toBe("0.00");
  });

  it("menolak nilai di luar rentang 0 sampai 100", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const t1 = await komponen(k, "T1");
        await k.query(
          `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
           VALUES ($1, $2, $3, 101, $4)`,
          [b.penugasanBioX1, t1, b.siswaAndi, b.guruBio],
        );
      }),
    );

    expect(tolak.constraint).toBe("ck_nilai_rentang");
  });
});

describe("I-13 satu nilai per komponen per penugasan", () => {
  it("menolak nilai kedua pada komponen dan siswa yang sama", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const t1 = await komponen(k, "T1");
        const sisip = `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
                       VALUES ($1, $2, $3, $4, $5)`;
        await k.query(sisip, [b.penugasanBioX1, t1, b.siswaAndi, 80, b.guruBio]);
        await k.query(sisip, [b.penugasanBioX1, t1, b.siswaAndi, 90, b.guruBio]);
      }),
    );

    expect(tolak.constraint).toBe("uq_nilai");
  });
});

describe("I-14 satu sesi per penugasan per tanggal", () => {
  it("menolak sesi kedua pada tanggal yang sama", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const sisip = `INSERT INTO sesi (penugasan_ref, tanggal, dibuka_oleh) VALUES ($1, $2, $3)`;
        await k.query(sisip, [b.penugasanBioX1, "2026-09-01", b.guruBio]);
        await k.query(sisip, [b.penugasanBioX1, "2026-09-01", b.guruBio]);
      }),
    );

    expect(tolak.constraint).toBe("uq_sesi_penugasan_tanggal");
  });
});

describe("I-15 setiap siswa tepat satu status per sesi", () => {
  it("berstatus alpa ketika status tidak disebutkan — AC-11", async () => {
    const status = await dalamTransaksiBatal(async (k) => {
      const sesi = await k.query<{ id: string }>(
        `INSERT INTO sesi (penugasan_ref, tanggal, dibuka_oleh) VALUES ($1, $2, $3) RETURNING id`,
        [b.penugasanBioX1, "2026-09-02", b.guruBio],
      );
      const hasil = await k.query<{ status: string }>(
        `INSERT INTO presensi (sesi_ref, siswa_ref, diperbarui_oleh) VALUES ($1, $2, $3)
         RETURNING status`,
        [sesi.rows[0]?.id, b.siswaAndi, b.guruBio],
      );
      return hasil.rows[0]?.status;
    });

    expect(status).toBe("alpa");
  });

  it("menolak status kedua bagi siswa yang sama pada satu sesi", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const sesi = await k.query<{ id: string }>(
          `INSERT INTO sesi (penugasan_ref, tanggal, dibuka_oleh) VALUES ($1, $2, $3) RETURNING id`,
          [b.penugasanBioX1, "2026-09-03", b.guruBio],
        );
        const sisip = `INSERT INTO presensi (sesi_ref, siswa_ref, status, diperbarui_oleh)
                       VALUES ($1, $2, $3, $4)`;
        await k.query(sisip, [sesi.rows[0]?.id, b.siswaAndi, "hadir", b.guruBio]);
        await k.query(sisip, [sesi.rows[0]?.id, b.siswaAndi, "izin", b.guruBio]);
      }),
    );

    expect(tolak.constraint).toBe("uq_presensi");
  });

  it("menolak status di luar keempatnya", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const sesi = await k.query<{ id: string }>(
          `INSERT INTO sesi (penugasan_ref, tanggal, dibuka_oleh) VALUES ($1, $2, $3) RETURNING id`,
          [b.penugasanBioX1, "2026-09-04", b.guruBio],
        );
        await k.query(
          `INSERT INTO presensi (sesi_ref, siswa_ref, status, diperbarui_oleh)
           VALUES ($1, $2, 'bolos', $3)`,
          [sesi.rows[0]?.id, b.siswaAndi, b.guruBio],
        );
      }),
    );

    expect(tolak.constraint).toBe("ck_presensi_status");
  });
});

describe("I-16 hapus sesi menghapus seluruh statusnya — AC-25", () => {
  it("menghapus presensi bersama sesinya", async () => {
    const sisa = await dalamTransaksiBatal(async (k) => {
      const sesi = await k.query<{ id: string }>(
        `INSERT INTO sesi (penugasan_ref, tanggal, dibuka_oleh) VALUES ($1, $2, $3) RETURNING id`,
        [b.penugasanBioX1, "2026-09-05", b.guruBio],
      );
      const sesiRef = sesi.rows[0]?.id;

      await k.query(
        `INSERT INTO presensi (sesi_ref, siswa_ref, diperbarui_oleh) VALUES ($1, $2, $3)`,
        [sesiRef, b.siswaAndi, b.guruBio],
      );
      await k.query(`DELETE FROM sesi WHERE id = $1`, [sesiRef]);

      const hasil = await k.query<{ jumlah: string }>(
        `SELECT count(*)::text AS jumlah FROM presensi WHERE sesi_ref = $1`,
        [sesiRef],
      );
      return hasil.rows[0]?.jumlah;
    });

    expect(sisa).toBe("0");
  });
});

describe("Pasal 6 — RESTRICT adalah bawaan yang disengaja", () => {
  // Budi sengaja dipakai: ia belum terdaftar pada kelas mana pun, sehingga yang
  // menolak benar-benar rujukan dari presensi dan bukan dari kelas_siswa.
  it("menolak penghapusan siswa yang masih memiliki presensi", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const sesi = await k.query<{ id: string }>(
          `INSERT INTO sesi (penugasan_ref, tanggal, dibuka_oleh) VALUES ($1, $2, $3) RETURNING id`,
          [b.penugasanBioX1, "2026-09-06", b.guruBio],
        );
        await k.query(
          `INSERT INTO presensi (sesi_ref, siswa_ref, diperbarui_oleh) VALUES ($1, $2, $3)`,
          [sesi.rows[0]?.id, b.siswaBudi, b.guruBio],
        );
        await k.query(`DELETE FROM siswa WHERE pengguna_ref = $1`, [b.siswaBudi]);
      }),
    );

    expect(tolak.pesan).toContain("presensi");
  });

  it("menolak penghapusan mapel yang masih dipakai penugasan", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) => k.query(`DELETE FROM mapel WHERE id = $1`, [b.mapelBio])),
    );

    expect(tolak.pesan).toContain("penugasan");
  });
});

describe("I-19 satu rapor per siswa per semester", () => {
  const sisipRapor = `INSERT INTO rapor (siswa_ref, kelas_ref, periode_ref) VALUES ($1, $2, $3)`;

  it("menolak rapor kedua pada periode yang sama", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        await k.query(sisipRapor, [b.siswaAndi, b.kelasX1, b.periodeGanjil]);
        await k.query(sisipRapor, [b.siswaAndi, b.kelasX1, b.periodeGanjil]);
      }),
    );

    expect(tolak.constraint).toBe("uq_rapor_siswa_periode");
  });

  it("menolak periode yang menyimpang dari periode kelasnya", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) => k.query(sisipRapor, [b.siswaAndi, b.kelasX1, b.periodeGenap])),
    );

    expect(tolak.constraint).toBe("fk_rapor_kelas");
  });
});

describe("konsistensi status rapor", () => {
  it("menolak status finalized tanpa siapa dan kapan", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO rapor (siswa_ref, kelas_ref, periode_ref, status)
           VALUES ($1, $2, $3, 'finalized')`,
          [b.siswaAndi, b.kelasX1, b.periodeGanjil],
        ),
      ),
    );

    expect(tolak.constraint).toBe("ck_rapor_finalisasi");
  });

  it("menolak waktu distribusi pada rapor yang belum didistribusikan", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal((k) =>
        k.query(
          `INSERT INTO rapor (siswa_ref, kelas_ref, periode_ref, didistribusikan_pada)
           VALUES ($1, $2, $3, now())`,
          [b.siswaAndi, b.kelasX1, b.periodeGanjil],
        ),
      ),
    );

    expect(tolak.constraint).toBe("ck_rapor_distribusi");
  });
});

describe("I-21 status rapor hanya bergerak maju", () => {
  async function raporFinal(k: PoolClient): Promise<string> {
    const hasil = await k.query<{ id: string }>(
      `INSERT INTO rapor (siswa_ref, kelas_ref, periode_ref, status, difinalisasi_oleh, difinalisasi_pada)
       VALUES ($1, $2, $3, 'finalized', $4, now()) RETURNING id`,
      [b.siswaAndi, b.kelasX1, b.periodeGanjil, b.guruBio],
    );
    const id = hasil.rows[0]?.id;
    if (!id) throw new Error("Rapor uji gagal dibuat");
    return id;
  }

  it("menolak finalized kembali menjadi draft", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const rapor = await raporFinal(k);
        await k.query(`UPDATE rapor SET status = 'draft' WHERE id = $1`, [rapor]);
      }),
    );

    expect(tolak.pesan).toContain("hanya bergerak maju");
  });

  it("menolak distributed kembali menjadi finalized", async () => {
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        const rapor = await raporFinal(k);
        await k.query(
          `UPDATE rapor SET status = 'distributed', didistribusikan_pada = now() WHERE id = $1`,
          [rapor],
        );
        await k.query(
          `UPDATE rapor SET status = 'finalized', didistribusikan_pada = NULL WHERE id = $1`,
          [rapor],
        );
      }),
    );

    expect(tolak.pesan).toContain("hanya bergerak maju");
  });

  it("menerima draft maju menjadi finalized lalu distributed", async () => {
    await dalamTransaksiBatal(async (k) => {
      const rapor = await raporFinal(k);
      await k.query(
        `UPDATE rapor SET status = 'distributed', didistribusikan_pada = now() WHERE id = $1`,
        [rapor],
      );
    });
  });
});
