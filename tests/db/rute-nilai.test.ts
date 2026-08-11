import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { masukSebagai, nyalakanAppUji, panggilJson, type AppUji } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import {
  A6,
  bersihkanPencatatanA6,
  finalisasiRaporA6,
  hapusFixtureA6,
  kembalikanRaporDraftA6,
  komponenSnapshotA6,
  pasangFixtureA6,
} from "./fixture-a6.js";
import { dalamTransaksiBatal, harusDitolak } from "./bantuan.js";

/**
 * Uji rute nilai — API.md §6, ARCHITECTURE.md §14.1.
 *
 * Satu request satu transaksi; `null` menghapus baris (I-12); lapis baris
 * Guru/Wali Kelas/Siswa (I-25); rapor final mengunci Guru (I-22, AC-14).
 */

let app: AppUji;
let sesiAdmin: string;
let sesiGuruPengampu: string;
let sesiGuruAsing: string;
let sesiGuruWali: string;
let sesiSiswa1: string;
let komponen: readonly string[];

beforeAll(async () => {
  await pasangFixtureA6();
  app = await nyalakanAppUji();
  sesiAdmin = await masukSebagai(app, "admin");
  sesiGuruPengampu = await masukSebagai(app, "a6-guru-pengampu");
  sesiGuruAsing = await masukSebagai(app, "a6-guru-asing");
  sesiGuruWali = await masukSebagai(app, "a6-guru-wali");
  sesiSiswa1 = await masukSebagai(app, "a6-siswa-1");
  komponen = await komponenSnapshotA6();
});

afterAll(async () => {
  // Kembalikan keadaan bersih (termasuk melepas snapshot komponen) supaya tes
  // invarian pada komponen benih tidak mewarisi rantai FK dari fixture ini.
  await hapusKeanggotaanLamaSiswa1();
  await hapusFixtureA6();
  await app.tutup();
  await tutupPool();
});

beforeEach(async () => {
  await hapusKeanggotaanLamaSiswa1();
  await bersihkanPencatatanA6();
});

describe("GET /api/penugasan/:id/nilai", () => {
  it("Guru pengampu menerima matriks dengan delapan komponen dan tiga siswa", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      sesi: sesiGuruPengampu,
    });
    expect(jawab.status).toBe(200);
    const data = (
      jawab.badan as {
        data: {
          penugasan: { id: string; kelas_nama: string; mapel_nama: string; kkm: number };
          komponen: unknown[];
          siswa: Array<{ siswa_ref: string; nama: string }>;
          nilai: unknown[];
        };
      }
    ).data;
    expect(data.penugasan).toEqual({
      id: A6.penugasan,
      kelas_nama: "a6-X-1",
      mapel_nama: "Biologi A6",
      kkm: 75,
    });
    expect(data.komponen).toHaveLength(8);
    expect(data.siswa).toEqual([
      { siswa_ref: A6.siswa2, nama: "Siswa Dua" },
      { siswa_ref: A6.siswa1, nama: "Siswa Satu" },
      { siswa_ref: A6.siswa3, nama: "Siswa Tiga" },
    ]);
    expect(data.nilai).toHaveLength(0);
  });

  it("Administrator menerima matriks penugasan mana pun", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      sesi: sesiAdmin,
    });
    expect(jawab.status).toBe(200);
  });

  it("Guru asing ditolak 403 — bukan 404", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      sesi: sesiGuruAsing,
    });
    expect(jawab.status).toBe(403);
    expect((jawab.badan as { kesalahan: { kode: string } }).kesalahan.kode).toBe(
      "KEWENANGAN_DITOLAK",
    );
  });

  it("Siswa ditolak 403 pada lapis peran", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      sesi: sesiSiswa1,
    });
    expect(jawab.status).toBe(403);
  });

  it("UUID tidak sah dijawab 400", async () => {
    const jawab = await panggilJson(app, "/api/penugasan/bukan-uuid/nilai", {
      sesi: sesiGuruPengampu,
    });
    expect(jawab.status).toBe(400);
    expect((jawab.badan as { kesalahan: { kode: string } }).kesalahan.kode).toBe(
      "PERMINTAAN_TIDAK_SAH",
    );
  });

  it("Penugasan yang tidak ada dijawab 404", async () => {
    const jawab = await panggilJson(
      app,
      "/api/penugasan/00000000-0000-4000-8000-00000000ffff/nilai",
      { sesi: sesiGuruPengampu },
    );
    expect(jawab.status).toBe(404);
    expect((jawab.badan as { kesalahan: { kode: string } }).kesalahan.kode).toBe("TIDAK_DITEMUKAN");
  });

  it("Tanpa sesi dijawab 401", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`);
    expect(jawab.status).toBe(401);
  });
});

describe("POST /api/penugasan/:id/nilai", () => {
  it("menyimpan nilai dan menjawab ringkasan tersimpan", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: {
        nilai: [
          { siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 85 },
          { siswa_ref: A6.siswa1, komponen_ref: komponen[1], nilai: 90.5 },
          { siswa_ref: A6.siswa2, komponen_ref: komponen[0], nilai: 0 },
        ],
        topik: [{ komponen_ref: komponen[0], topik: "Sel dan jaringan" }],
      },
    });
    expect(jawab.status).toBe(200);
    expect((jawab.badan as { data: { tersimpan: number; terhapus: number } }).data).toEqual({
      tersimpan: 3,
      terhapus: 0,
    });

    const tersimpan = await poolPemilik().query(
      `SELECT nilai FROM nilai WHERE penugasan_ref = $1 AND siswa_ref = $2 AND komponen_ref = $3`,
      [A6.penugasan, A6.siswa1, komponen[0]],
    );
    expect(Number(tersimpan.rows[0]?.nilai)).toBe(85);

    const topik = await poolPemilik().query(
      `SELECT topik FROM penugasan_komponen WHERE penugasan_ref = $1 AND komponen_ref = $2`,
      [A6.penugasan, komponen[0]],
    );
    expect(topik.rows[0]?.topik).toBe("Sel dan jaringan");
  });

  it("nilai null menghapus baris — I-12", async () => {
    await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 75 }] },
    });
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: null }] },
    });
    expect(jawab.status).toBe(200);
    expect((jawab.badan as { data: { terhapus: number } }).data.terhapus).toBe(1);

    const baris = await poolPemilik().query(
      `SELECT 1 FROM nilai WHERE penugasan_ref = $1 AND siswa_ref = $2 AND komponen_ref = $3`,
      [A6.penugasan, A6.siswa1, komponen[0]],
    );
    expect(baris.rows).toHaveLength(0);
  });

  it("nilai di luar rentang ditolak 400", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 101 }] },
    });
    expect(jawab.status).toBe(400);
  });

  it("nilai lebih dari dua desimal ditolak 400", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 85.555 }] },
    });
    expect(jawab.status).toBe(400);
  });

  it("tetap menolak pecahan tiga desimal", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 0.291 }] },
    });
    expect(jawab.status).toBe(400);
  });

  it("nilai dua desimal yang terkena floating-point tetap diterima", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: {
        nilai: [
          { siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 0.29 },
          { siswa_ref: A6.siswa1, komponen_ref: komponen[1], nilai: 0.57 },
        ],
      },
    });
    expect(jawab.status).toBe(200);
  });

  it("duplikat pasangan siswa-komponen dalam satu payload ditolak 400", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: {
        nilai: [
          { siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 80 },
          { siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 90 },
        ],
      },
    });
    expect(jawab.status).toBe(400);
  });

  it("siswa asing ditolak 400 — SCHEMA.md §11, S-01", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswaAsing, komponen_ref: komponen[0], nilai: 80 }] },
    });
    expect(jawab.status).toBe(400);
    const baris = await poolPemilik().query(`SELECT 1 FROM nilai WHERE penugasan_ref = $1`, [
      A6.penugasan,
    ]);
    expect(baris.rows).toHaveLength(0);
  });

  it("komponen asing ditolak 400 — CK-API-15", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: A6.komponenAsing, nilai: 80 }] },
    });
    expect(jawab.status).toBe(400);
  });

  it("Guru asing ditolak 403", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruAsing,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 80 }] },
    });
    expect(jawab.status).toBe(403);
  });

  it("Guru ditolak 409 RAPOR_TERKUNCI apabila rapor sudah final — I-22, AC-14", async () => {
    await finalisasiRaporA6();
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 80 }] },
    });
    expect(jawab.status).toBe(409);
    expect((jawab.badan as { kesalahan: { kode: string } }).kesalahan.kode).toBe("RAPOR_TERKUNCI");
    await kembalikanRaporDraftA6();
  });

  it("Administrator dilanjutkan meskipun rapor sudah final — P13, API.md §6.2", async () => {
    await finalisasiRaporA6();
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiAdmin,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 80 }] },
    });
    expect(jawab.status).toBe(200);
    await kembalikanRaporDraftA6();
  });

  it("bidang tidak dikenal ditolak 400 — payload strict", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [], tambahan: "tidak dikenal" },
    });
    expect(jawab.status).toBe(400);
  });

  it("rollback: kesalahan di baris terakhir membatalkan seluruhnya — C-02, AC-15", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: {
        nilai: [
          { siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 80 },
          { siswa_ref: A6.siswa1, komponen_ref: komponen[1], nilai: 85 },
          { siswa_ref: A6.siswaAsing, komponen_ref: komponen[0], nilai: 90 },
        ],
      },
    });
    expect(jawab.status).toBe(400);
    const baris = await poolPemilik().query(`SELECT 1 FROM nilai WHERE penugasan_ref = $1`, [
      A6.penugasan,
    ]);
    expect(baris.rows).toHaveLength(0);
  });

  it("rollback: kegagalan basis data di tengah transaksi membatalkan seluruhnya — C-02, AC-15", async () => {
    // Simpan dua baris lebih dahulu lewat jalur API yang sah.
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: {
        nilai: [
          { siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 80 },
          { siswa_ref: A6.siswa1, komponen_ref: komponen[1], nilai: 85 },
        ],
      },
    });
    expect(jawab.status).toBe(200);

    // Transaksi campuran pada transaksi batal: DELETE pertama berhasil; INSERT
    // berikutnya menyebut komponen yang tidak ada sama sekali — ditolak FK
    // nilai.komponen_ref, dan seluruh transaksi batal.
    const komponenTidakAda = "a6000000-0000-4000-8000-000000000082";
    const tolak = await harusDitolak(() =>
      dalamTransaksiBatal(async (k) => {
        await k.query(`DELETE FROM nilai WHERE penugasan_ref = '${A6.penugasan}'`);
        await k.query(
          `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
           VALUES ('${A6.penugasan}', '${komponenTidakAda}', '${A6.siswa1}', 90, '${A6.guruPengampu}')`,
        );
      }),
    );
    expect(tolak.kode).toBe("23503");
    expect(tolak.constraint).toBe("nilai_komponen_ref_fkey");

    // Kedua baris nilai awal utuh — DELETE yang mendahului kegagalan turut batal.
    const baris = await poolPemilik().query(`SELECT 1 FROM nilai WHERE penugasan_ref = $1`, [
      A6.penugasan,
    ]);
    expect(baris.rows).toHaveLength(2);
  });
});

describe("GET /api/kelas/:id/nilai", () => {
  it("Wali Kelas membaca nilai sekelas", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A6.kelas}/nilai`, {
      sesi: sesiGuruWali,
    });
    expect(jawab.status).toBe(200);
  });

  it("mengunci seluruh rapor draft agar penyimpanan serial terhadap finalisasi — I-22", async () => {
    await kembalikanRaporDraftA6();
    const penghalang = await poolPemilik().connect();
    const finalisasi = await poolPemilik().connect();
    const kunciAdvisory = 600022;
    try {
      await poolPemilik().query(
        `CREATE OR REPLACE FUNCTION a6_tahan_simpan_nilai() RETURNS trigger AS $$
         BEGIN
           IF NEW.penugasan_ref = '${A6.penugasan}' THEN
             PERFORM pg_advisory_xact_lock(${kunciAdvisory});
           END IF;
           RETURN NEW;
         END;
         $$ LANGUAGE plpgsql;
         CREATE TRIGGER trg_a6_tahan_simpan_nilai
           BEFORE INSERT ON nilai FOR EACH ROW EXECUTE FUNCTION a6_tahan_simpan_nilai()`,
      );
      await penghalang.query(`SELECT pg_advisory_lock($1)`, [kunciAdvisory]);
      const permintaan = panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
        metode: "POST",
        sesi: sesiGuruPengampu,
        badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 80 }] },
      });

      for (let percobaan = 0; percobaan < 40; percobaan += 1) {
        const tunggu = await finalisasi.query<{ menunggu: string }>(
          `SELECT count(*)::text AS menunggu
           FROM pg_stat_activity
           WHERE wait_event_type = 'Lock' AND lower(coalesce(wait_event, '')) = 'advisory'`,
        );
        if (Number(tunggu.rows[0]?.menunggu) > 0) break;
        await new Promise((selesai) => setTimeout(selesai, 25));
      }

      await finalisasi.query("BEGIN");
      await finalisasi.query(`SET LOCAL lock_timeout = '200ms'`);
      let kodeGalat: string | undefined;
      try {
        await finalisasi.query(
          `UPDATE rapor
         SET status = 'finalized', difinalisasi_oleh = $3, difinalisasi_pada = now()
         WHERE kelas_ref = $1 AND periode_ref = $2`,
          [A6.kelas, A6.periode, A6.guruPengampu],
        );
      } catch (galat) {
        kodeGalat = (galat as { code?: string }).code;
      }
      await finalisasi.query("ROLLBACK");
      await penghalang.query(`SELECT pg_advisory_unlock($1)`, [kunciAdvisory]);

      const jawab = await permintaan;
      expect(kodeGalat).toBe("55P03");
      expect(jawab.status).toBe(200);
    } finally {
      await finalisasi.query("ROLLBACK").catch(() => undefined);
      await penghalang
        .query(`SELECT pg_advisory_unlock($1)`, [kunciAdvisory])
        .catch(() => undefined);
      finalisasi.release();
      penghalang.release();
      await poolPemilik().query(`DROP TRIGGER IF EXISTS trg_a6_tahan_simpan_nilai ON nilai`);
      await poolPemilik().query(`DROP FUNCTION IF EXISTS a6_tahan_simpan_nilai()`);
      await kembalikanRaporDraftA6();
    }
  });

  it("Administrator membaca nilai kelas mana pun", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A6.kelas}/nilai`, {
      sesi: sesiAdmin,
    });
    expect(jawab.status).toBe(200);
  });

  it("Guru asing (bukan wali) ditolak 403", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A6.kelas}/nilai`, {
      sesi: sesiGuruAsing,
    });
    expect(jawab.status).toBe(403);
  });

  it("Siswa ditolak 403", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A6.kelas}/nilai`, {
      sesi: sesiSiswa1,
    });
    expect(jawab.status).toBe(403);
  });
});

describe("GET /api/saya/nilai", () => {
  it("memilih keanggotaan pada periode aktif, bukan riwayat pertama", async () => {
    const pool = poolPemilik();
    const tahunAktif = "a6000000-0000-4000-8000-000000000032";
    const periodeAktif = "a6000000-0000-4000-8000-000000000042";
    const kelasAktif = "a6000000-0000-4000-8000-000000000052";
    try {
      await pool.query(`UPDATE periode SET aktif = false WHERE id = $1`, [A6.periode]);
      await pool.query(
        `INSERT INTO tahun_ajaran (id, nama, tgl_mulai, tgl_selesai, aktif)
         VALUES ($1, 'a6-2027/2028', '2027-07-01', '2028-06-30', true)`,
        [tahunAktif],
      );
      await pool.query(
        `INSERT INTO periode (id, tahun_ajaran_ref, semester, tgl_mulai, tgl_selesai, aktif)
         VALUES ($1, $2, 'ganjil', '2027-07-01', '2027-12-31', true)`,
        [periodeAktif, tahunAktif],
      );
      await pool.query(
        `INSERT INTO kelas (id, periode_ref, nama, tingkat) VALUES ($1, $2, 'a6-X-aktif', 'X')`,
        [kelasAktif, periodeAktif],
      );
      await pool.query(
        `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES ($1, $2, $3)`,
        [kelasAktif, A6.siswa1, periodeAktif],
      );

      const jawab = await panggilJson(app, "/api/saya/nilai", { sesi: sesiSiswa1 });
      expect(jawab.status).toBe(200);
      expect((jawab.badan as { data: { periode_nama: string; mapel: unknown[] } }).data).toEqual({
        periode_nama: "a6-2027/2028 Ganjil",
        mapel: [],
      });
    } finally {
      await pool.query(`DELETE FROM kelas_siswa WHERE kelas_ref = $1`, [kelasAktif]);
      await pool.query(`DELETE FROM kelas WHERE id = $1`, [kelasAktif]);
      await pool.query(`DELETE FROM periode WHERE id = $1`, [periodeAktif]);
      await pool.query(`DELETE FROM tahun_ajaran WHERE id = $1`, [tahunAktif]);
      await pool.query(`UPDATE periode SET aktif = true WHERE id = $1`, [A6.periode]);
    }
  });

  it("Siswa membaca nilainya sendiri — I-25", async () => {
    await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: {
        nilai: [
          { siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 88.5 },
          { siswa_ref: A6.siswa2, komponen_ref: komponen[0], nilai: 60 },
        ],
      },
    });
    const jawab = await panggilJson(app, "/api/saya/nilai", { sesi: sesiSiswa1 });
    expect(jawab.status).toBe(200);
    const data = (
      jawab.badan as {
        data: { mapel: { komponen: { nilai: number | null }[] }[] };
      }
    ).data;
    // Siswa 1 hanya memiliki satu nilai; nilai siswa 2 tidak pernah muncul —
    // sisanya null, bukan 60.
    const semuaNilai = data.mapel.flatMap((m) => m.komponen.map((k) => k.nilai));
    expect(semuaNilai.filter((n) => n !== null)).toEqual([88.5]);
    expect(semuaNilai).not.toContain(60);
  });

  it("memilih kelas pada periode aktif, bukan keanggotaan lama", async () => {
    await pasangKeanggotaanLamaSiswa1();
    const jawab = await panggilJson(app, "/api/saya/nilai", { sesi: sesiSiswa1 });
    expect(jawab.status).toBe(200);
    expect(
      (jawab.badan as { data: { periode_nama: string; mapel: Array<{ mapel_nama: string }> } })
        .data,
    ).toMatchObject({
      periode_nama: "a6-2026/2027 Ganjil",
      mapel: [{ mapel_nama: "Biologi A6" }],
    });
  });

  it("nilai_akhir null selama belum lengkap — AC-06", async () => {
    await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: { nilai: [{ siswa_ref: A6.siswa1, komponen_ref: komponen[0], nilai: 80 }] },
    });
    const jawab = await panggilJson(app, "/api/saya/nilai", { sesi: sesiSiswa1 });
    const mapel = (
      jawab.badan as {
        data: { mapel: { lengkap: boolean; nilai_akhir: number | null }[] };
      }
    ).data.mapel;
    expect(mapel[0]?.lengkap).toBe(false);
    expect(mapel[0]?.nilai_akhir).toBeNull();
  });

  it("nilai_akhir terisi setelah seluruh komponen terisi — AC-05", async () => {
    await panggilJson(app, `/api/penugasan/${A6.penugasan}/nilai`, {
      metode: "POST",
      sesi: sesiGuruPengampu,
      badan: {
        nilai: komponen.map((k) => ({ siswa_ref: A6.siswa1, komponen_ref: k, nilai: 80 })),
      },
    });
    const jawab = await panggilJson(app, "/api/saya/nilai", { sesi: sesiSiswa1 });
    const mapel = (
      jawab.badan as {
        data: { mapel: { lengkap: boolean; nilai_akhir: number | null }[] };
      }
    ).data.mapel;
    expect(mapel[0]?.lengkap).toBe(true);
    expect(mapel[0]?.nilai_akhir).toBe(80);
  });

  it("Guru ditolak 403 pada endpoint siswa", async () => {
    const jawab = await panggilJson(app, "/api/saya/nilai", { sesi: sesiGuruPengampu });
    expect(jawab.status).toBe(403);
  });
});

async function pasangKeanggotaanLamaSiswa1(): Promise<void> {
  const pool = poolPemilik();
  await pool.query(`DELETE FROM kelas_siswa WHERE kelas_ref = $1 AND siswa_ref = $2`, [
    A6.kelas,
    A6.siswa1,
  ]);
  await pool.query(
    `INSERT INTO tahun_ajaran (id, nama, tgl_mulai, tgl_selesai, aktif)
     VALUES ('a6000000-0000-4000-8000-000000000131', 'a6-2025/2026', '2025-07-01', '2026-06-30', false)
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO periode (id, tahun_ajaran_ref, semester, tgl_mulai, tgl_selesai, aktif)
     VALUES ('a6000000-0000-4000-8000-000000000141', 'a6000000-0000-4000-8000-000000000131', 'ganjil', '2025-07-01', '2025-12-31', false)
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO kelas (id, periode_ref, nama, tingkat, wali_kelas_ref)
     VALUES ('a6000000-0000-4000-8000-000000000151', 'a6000000-0000-4000-8000-000000000141', 'a6-X-lama', 'X', '${A6.guruWali}')
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES
      ('a6000000-0000-4000-8000-000000000151', '${A6.siswa1}', 'a6000000-0000-4000-8000-000000000141'),
      ('${A6.kelas}', '${A6.siswa1}', '${A6.periode}')
     ON CONFLICT DO NOTHING`,
  );
}

async function hapusKeanggotaanLamaSiswa1(): Promise<void> {
  const pool = poolPemilik();
  await pool.query(
    `DELETE FROM kelas_siswa WHERE kelas_ref = 'a6000000-0000-4000-8000-000000000151'`,
  );
  await pool.query(`DELETE FROM kelas WHERE id = 'a6000000-0000-4000-8000-000000000151'`);
  await pool.query(`DELETE FROM periode WHERE id = 'a6000000-0000-4000-8000-000000000141'`);
  await pool.query(`DELETE FROM tahun_ajaran WHERE id = 'a6000000-0000-4000-8000-000000000131'`);
  await pool.query(
    `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [A6.kelas, A6.siswa1, A6.periode],
  );
}
