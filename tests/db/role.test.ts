import { Pool } from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";

import { harusDitolak } from "./bantuan.js";

// SCHEMA.md Pasal 7 dan sec 7.1. Dua jaminan dari satu role, keduanya dibuktikan
// dengan kueri yang gagal — bukan dengan pembacaan kode (ARCHITECTURE.md sec 8).

const b = inject("benih");

const ro = new Pool({ connectionString: inject("urlRo"), max: 2 });
const rw = new Pool({ connectionString: inject("urlRw"), max: 2 });

afterAll(async () => {
  await Promise.all([ro.end(), rw.end()]);
});

describe("I-23 dan AC-20 — jalur AI tidak pernah menulis", () => {
  it("menolak UPDATE atas nilai", async () => {
    const tolak = await harusDitolak(() => ro.query(`UPDATE nilai SET nilai = 100`));

    expect(tolak.pesan).toContain("permission denied");
    expect(tolak.pesan).toContain("nilai");
  });

  it("menolak INSERT ke presensi", async () => {
    const tolak = await harusDitolak(() =>
      ro.query(
        `INSERT INTO presensi (sesi_ref, siswa_ref, diperbarui_oleh)
         VALUES (gen_random_uuid(), $1, $2)`,
        [b.siswaAndi, b.guruBio],
      ),
    );

    expect(tolak.pesan).toContain("permission denied");
  });

  it("menolak DELETE atas sesi", async () => {
    const tolak = await harusDitolak(() => ro.query(`DELETE FROM sesi`));

    expect(tolak.pesan).toContain("permission denied");
  });

  it("menolak penulisan ke rapor dan status finalnya", async () => {
    const tolak = await harusDitolak(() => ro.query(`UPDATE rapor SET status = 'distributed'`));

    expect(tolak.pesan).toContain("permission denied");
  });
});

describe("sec 7.1 — jalur AI tidak dapat memperoleh identitas siapa pun", () => {
  it.each(["pengguna", "guru", "siswa"])("menolak SELECT atas %s", async (tabel) => {
    const tolak = await harusDitolak(() => ro.query(`SELECT * FROM ${tabel} LIMIT 1`));

    expect(tolak.pesan).toContain("permission denied");
    expect(tolak.pesan).toContain(tabel);
  });

  it("menolak SELECT atas rapor dan rapor_mapel yang di luar cakupan Suggestion", async () => {
    for (const tabel of ["rapor", "rapor_mapel"]) {
      const tolak = await harusDitolak(() => ro.query(`SELECT * FROM ${tabel} LIMIT 1`));
      expect(tolak.pesan).toContain("permission denied");
    }
  });

  it("menolak SELECT atas tabel penopang dan jejak", async () => {
    for (const tabel of ["audit_log", "sesi_masuk", "pembatas_laju"]) {
      const tolak = await harusDitolak(() => ro.query(`SELECT * FROM ${tabel} LIMIT 1`));
      expect(tolak.pesan).toContain("permission denied");
    }
  });
});

describe("app_ro tetap dapat membaca yang diperlukan menyusun prompt", () => {
  const dibolehkan = [
    "nilai",
    "presensi",
    "sesi",
    "mapel",
    "penugasan",
    "penugasan_komponen",
    "komponen_penilaian",
    "kelas",
    "kelas_siswa",
    "periode",
    "tahun_ajaran",
  ];

  it.each(dibolehkan)("membaca %s", async (tabel) => {
    await expect(ro.query(`SELECT * FROM ${tabel} LIMIT 1`)).resolves.toBeDefined();
  });

  it("dapat menjalankan kueri kehadiran sec 8.3 apa adanya", async () => {
    const hasil = await ro.query(
      `SELECT pg.mapel_ref,
              round(100.0 * count(*) FILTER (WHERE p.status <> 'alpa') / count(*), 2) AS kehadiran_persen
       FROM presensi  p
       JOIN sesi      s  ON s.id = p.sesi_ref
       JOIN penugasan pg ON pg.id = s.penugasan_ref
       JOIN kelas     kl ON kl.id = pg.kelas_ref
       WHERE p.siswa_ref = $1 AND kl.periode_ref = $2
       GROUP BY pg.mapel_ref`,
      [b.siswaAndi, b.periodeGanjil],
    );

    expect(hasil.rows).toBeDefined();
  });
});

describe("app_rw memperoleh hak tulis pada data operasional", () => {
  it("dapat menulis dan membatalkan tulisannya", async () => {
    const klien = await rw.connect();
    try {
      await klien.query("BEGIN");
      await klien.query(`UPDATE mapel SET kkm = 76 WHERE id = $1`, [b.mapelBio]);
    } finally {
      await klien.query("ROLLBACK");
      klien.release();
    }
  });

  it("hanya boleh menyisipkan pada audit_log, tidak mengubahnya", async () => {
    const tolak = await harusDitolak(() => rw.query(`UPDATE audit_log SET judul = 'x'`));

    expect(tolak.pesan).toContain("permission denied");
  });

  it("tidak dapat menyentuh catatan penerapan migrasi", async () => {
    const tolak = await harusDitolak(() => rw.query(`SELECT * FROM migrasi.diterapkan LIMIT 1`));

    expect(tolak.pesan).toContain("permission denied");
  });
});
