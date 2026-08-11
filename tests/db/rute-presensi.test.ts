import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { masukSebagai, nyalakanAppUji, panggilJson, type AppUji } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import {
  A6,
  bersihkanPencatatanA6,
  finalisasiRaporA6,
  hapusFixtureA6,
  kembalikanRaporDraftA6,
  pasangFixtureA6,
} from "./fixture-a6.js";

/**
 * Uji rute presensi — API.md §7 dan §9.
 *
 * Sesi dan seluruh status dibentuk atomik (I-14..I-16), persentase memakai
 * jumlah sesi sebagai penyebut dan hanya alpa yang mengurangi (I-17, I-18),
 * serta Siswa tidak pernah memperoleh rincian per tanggal (I-25, AC-30).
 */

let app: AppUji;
let sesiAdmin: string;
let sesiGuruPengampu: string;
let sesiGuruAsing: string;
let sesiGuruWali: string;
let sesiSiswa1: string;
let sesiSiswaAsing: string;

const UUID_TIDAK_ADA = "00000000-0000-4000-8000-00000000ffff";

beforeAll(async () => {
  await pasangFixtureA6();
  app = await nyalakanAppUji();
  sesiAdmin = await masukSebagai(app, "admin");
  sesiGuruPengampu = await masukSebagai(app, "a6-guru-pengampu");
  sesiGuruAsing = await masukSebagai(app, "a6-guru-asing");
  sesiGuruWali = await masukSebagai(app, "a6-guru-wali");
  sesiSiswa1 = await masukSebagai(app, "a6-siswa-1");
  sesiSiswaAsing = await masukSebagai(app, "a6-siswa-asing");
});

afterAll(async () => {
  await hapusPemicuPresensiUji();
  await hapusKeanggotaanLamaSiswa1();
  await hapusFixtureA6();
  await app.tutup();
  await tutupPool();
});

beforeEach(async () => {
  await hapusPemicuPresensiUji();
  await hapusKeanggotaanLamaSiswa1();
  await bersihkanPencatatanA6();
});

describe("GET /api/penugasan/:id/siswa", () => {
  it("mengembalikan tiga siswa kelas dalam bentuk snake_case", async () => {
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/siswa`, {
      sesi: sesiGuruPengampu,
    });
    expect(jawab.status).toBe(200);
    expect(jawab.badan).toEqual({
      data: {
        siswa: [
          { siswa_ref: A6.siswa2, nama: "Siswa Dua" },
          { siswa_ref: A6.siswa1, nama: "Siswa Satu" },
          { siswa_ref: A6.siswa3, nama: "Siswa Tiga" },
        ],
      },
    });
  });

  it("Administrator boleh membaca sedangkan Guru asing, Wali Kelas, dan Siswa ditolak", async () => {
    const [admin, asing, wali, siswa] = await Promise.all([
      panggilJson(app, `/api/penugasan/${A6.penugasan}/siswa`, { sesi: sesiAdmin }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/siswa`, { sesi: sesiGuruAsing }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/siswa`, { sesi: sesiGuruWali }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/siswa`, { sesi: sesiSiswa1 }),
    ]);
    expect(admin.status).toBe(200);
    expect(asing.status).toBe(403);
    expect(wali.status).toBe(403);
    expect(siswa.status).toBe(403);
  });

  it("membedakan UUID tidak sah, penugasan tidak ada, dan tanpa sesi", async () => {
    const [tidakSah, tidakAda, anonim] = await Promise.all([
      panggilJson(app, "/api/penugasan/bukan-uuid/siswa", { sesi: sesiGuruPengampu }),
      panggilJson(app, `/api/penugasan/${UUID_TIDAK_ADA}/siswa`, { sesi: sesiGuruPengampu }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/siswa`),
    ]);
    expect(tidakSah).toMatchObject({ status: 400, badan: { kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } } });
    expect(tidakAda).toMatchObject({ status: 404, badan: { kesalahan: { kode: "TIDAK_DITEMUKAN" } } });
    expect(anonim.status).toBe(401);
  });
});

describe("POST dan GET /api/penugasan/:id/sesi", () => {
  it("membuat sesi dan semua siswa; yang tidak disebut menjadi alpa — I-15, AC-11", async () => {
    const jawab = await buatSesi("2026-08-11", [
      { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
      { siswa_ref: A6.siswa2, status: "izin", catatan: "Surat orang tua" },
    ]);
    expect(jawab.status).toBe(201);
    const data = dataDari<{ sesi: { id: string; tanggal: string }; tersimpan: number }>(jawab);
    expect(data).toMatchObject({ sesi: { tanggal: "2026-08-11" }, tersimpan: 3 });
    expect(data.sesi.id).toMatch(/^[0-9a-f-]{36}$/);

    const baris = await poolPemilik().query<{ siswa_ref: string; status: string }>(
      `SELECT siswa_ref, status FROM presensi WHERE sesi_ref = $1 ORDER BY siswa_ref`,
      [data.sesi.id],
    );
    expect(baris.rows).toEqual([
      { siswa_ref: A6.siswa1, status: "hadir" },
      { siswa_ref: A6.siswa2, status: "izin" },
      { siswa_ref: A6.siswa3, status: "alpa" },
    ]);
  });

  it("GET mendaftar sesi tanggal YYYY-MM-DD beserta ringkasan", async () => {
    const id12 = await idSesi(await buatSesi("2026-08-12", [
      { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
    ]));
    const id11 = await idSesi(await buatSesi("2026-08-11", [
      { siswa_ref: A6.siswa1, status: "sakit", catatan: null },
      { siswa_ref: A6.siswa2, status: "izin", catatan: null },
    ]));
    const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, {
      sesi: sesiGuruPengampu,
    });
    expect(jawab.status).toBe(200);
    expect(jawab.badan).toEqual({ data: { sesi: [
      {
        id: id11,
        tanggal: "2026-08-11",
        ringkasan: { hadir: 0, izin: 1, sakit: 1, alpa: 1 },
      },
      {
        id: id12,
        tanggal: "2026-08-12",
        ringkasan: { hadir: 1, izin: 0, sakit: 0, alpa: 2 },
      },
    ] } });
  });

  it("menolak sesi kedua penugasan-tanggal dengan 409 SESI_SUDAH_ADA — I-14", async () => {
    expect((await buatSesi("2026-08-11", [])).status).toBe(201);
    const kedua = await buatSesi("2026-08-11", []);
    expect(kedua).toMatchObject({
      status: 409,
      badan: { kesalahan: { kode: "SESI_SUDAH_ADA" } },
    });
  });

  it("mengatasi race dua POST tanggal sama menjadi tepat satu 201 dan satu 409 — I-14", async () => {
    const hasil = await Promise.all([buatSesi("2026-08-11", []), buatSesi("2026-08-11", [])]);
    expect(hasil.map((j) => j.status).sort()).toEqual([201, 409]);
    const jumlah = await poolPemilik().query<{ jumlah: string }>(
      `SELECT count(*)::text AS jumlah FROM sesi WHERE penugasan_ref = $1 AND tanggal = '2026-08-11'`,
      [A6.penugasan],
    );
    expect(jumlah.rows[0]?.jumlah).toBe("1");
    expect(await jumlahPresensi()).toBe(3);
  });

  it("menolak siswa asing dan duplikat, tanpa meninggalkan sesi", async () => {
    for (const presensi of [
      [{ siswa_ref: A6.siswaAsing, status: "hadir", catatan: null }],
      [
        { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
        { siswa_ref: A6.siswa1, status: "alpa", catatan: null },
      ],
    ]) {
      const jawab = await buatSesi("2026-08-11", presensi);
      expect(jawab.status).toBe(400);
      expect(await jumlahSesi()).toBe(0);
    }
  });

  it("payload strict, status/catatan salah, UUID siswa salah, dan tanggal non-kalender ditolak 400", async () => {
    const badan = [
      { tanggal: "2026-08-11", presensi: [], tambahan: true },
      { tanggal: "2026-08-11", presensi: [{ siswa_ref: A6.siswa1, status: "terlambat", catatan: null }] },
      { tanggal: "2026-08-11", presensi: [{ siswa_ref: A6.siswa1, status: "hadir", catatan: "x".repeat(201) }] },
      { tanggal: "2026-08-11", presensi: [{ siswa_ref: "bukan-uuid", status: "hadir", catatan: null }] },
      { tanggal: "2026-02-30", presensi: [] },
    ];
    for (const satu of badan) {
      const jawab = await panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, {
        metode: "POST",
        sesi: sesiGuruPengampu,
        badan: satu,
      });
      expect(jawab.status).toBe(400);
    }
    expect(await jumlahSesi()).toBe(0);
  });

  it("menolak UUID penugasan tidak sah, Guru asing, Wali Kelas, dan Siswa", async () => {
    const [uuid, asing, wali, siswa] = await Promise.all([
      panggilJson(app, "/api/penugasan/bukan-uuid/sesi", { metode: "POST", sesi: sesiGuruPengampu, badan: { tanggal: "2026-08-11" } }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, { metode: "POST", sesi: sesiGuruAsing, badan: { tanggal: "2026-08-11" } }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, { metode: "POST", sesi: sesiGuruWali, badan: { tanggal: "2026-08-11" } }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, { metode: "POST", sesi: sesiSiswa1, badan: { tanggal: "2026-08-11" } }),
    ]);
    expect(uuid.status).toBe(400);
    expect(asing.status).toBe(403);
    expect(wali.status).toBe(403);
    expect(siswa.status).toBe(403);
  });

  it("GET daftar sesi hanya dapat dibaca Guru pengampu atau Administrator", async () => {
    const [admin, asing, wali, siswa, uuid, tidakAda] = await Promise.all([
      panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, { sesi: sesiAdmin }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, { sesi: sesiGuruAsing }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, { sesi: sesiGuruWali }),
      panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, { sesi: sesiSiswa1 }),
      panggilJson(app, "/api/penugasan/bukan-uuid/sesi", { sesi: sesiGuruPengampu }),
      panggilJson(app, `/api/penugasan/${UUID_TIDAK_ADA}/sesi`, { sesi: sesiGuruPengampu }),
    ]);
    expect(admin.status).toBe(200);
    expect(asing.status).toBe(403);
    expect(wali.status).toBe(403);
    expect(siswa.status).toBe(403);
    expect(uuid.status).toBe(400);
    expect(tidakAda.status).toBe(404);
  });

  it("rapor final mengunci Guru, tetapi Administrator tetap dapat membuat — I-22", async () => {
    await finalisasiRaporA6();
    const guru = await buatSesi("2026-08-11", []);
    expect(guru).toMatchObject({ status: 409, badan: { kesalahan: { kode: "RAPOR_TERKUNCI" } } });
    const admin = await buatSesi("2026-08-11", [], sesiAdmin);
    expect(admin.status).toBe(201);
    await kembalikanRaporDraftA6();
  });

  it("Guru tidak dapat menyelundupkan sesi ketika finalisasi rapor sedang berjalan", async () => {
    await kembalikanRaporDraftA6();
    const klien = await poolPemilik().connect();
    try {
      await klien.query("BEGIN");
      await klien.query(
        `SELECT id FROM rapor WHERE kelas_ref = $1 AND periode_ref = $2 FOR UPDATE`,
        [A6.kelas, A6.periode],
      );
      const permintaan = buatSesi("2026-08-11", []);
      expect(await selesaiDalam(permintaan, 100)).toBe(false);
      await klien.query(
        `UPDATE rapor
         SET status = 'finalized', difinalisasi_oleh = $3, difinalisasi_pada = now()
         WHERE kelas_ref = $1 AND periode_ref = $2`,
        [A6.kelas, A6.periode, A6.guruPengampu],
      );
      await klien.query("COMMIT");
      const jawab = await permintaan;
      expect(jawab).toMatchObject({
        status: 409,
        badan: { kesalahan: { kode: "RAPOR_TERKUNCI" } },
      });
      expect(await jumlahSesi()).toBe(0);
    } finally {
      await klien.query("ROLLBACK").catch(() => undefined);
      klien.release();
      await kembalikanRaporDraftA6();
    }
  });

  it("rollback ketika penyisipan presensi tengah gagal", async () => {
    await pasangPemicuPresensiUji("INSERT");
    expect((await buatSesi("2026-08-11", [])).status).toBe(500);
    await hapusPemicuPresensiUji();
    expect(await jumlahSesi()).toBe(0);
    expect(await jumlahPresensi()).toBe(0);
  });
});

describe("GET dan PUT /api/sesi/:id", () => {
  it("GET mengembalikan sesi lengkap snake_case dengan seluruh siswa", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", [
      { siswa_ref: A6.siswa1, status: "hadir", catatan: "Tepat waktu" },
    ]));
    const jawab = await panggilJson(app, `/api/sesi/${id}`, { sesi: sesiGuruPengampu });
    expect(jawab.status).toBe(200);
    expect(jawab.badan).toEqual({
      data: {
        id,
        penugasan_ref: A6.penugasan,
        tanggal: "2026-08-11",
        presensi: [
          { siswa_ref: A6.siswa2, nama: "Siswa Dua", status: "alpa", catatan: null },
          { siswa_ref: A6.siswa1, nama: "Siswa Satu", status: "hadir", catatan: "Tepat waktu" },
          { siswa_ref: A6.siswa3, nama: "Siswa Tiga", status: "alpa", catatan: null },
        ],
      },
    });
  });

  it("GET hanya dapat dibaca Guru pengampu atau Administrator", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    const [admin, asing, wali, siswa] = await Promise.all([
      panggilJson(app, `/api/sesi/${id}`, { sesi: sesiAdmin }),
      panggilJson(app, `/api/sesi/${id}`, { sesi: sesiGuruAsing }),
      panggilJson(app, `/api/sesi/${id}`, { sesi: sesiGuruWali }),
      panggilJson(app, `/api/sesi/${id}`, { sesi: sesiSiswa1 }),
    ]);
    expect(admin.status).toBe(200);
    expect(asing.status).toBe(403);
    expect(wali.status).toBe(403);
    expect(siswa.status).toBe(403);
  });

  it("PUT memperbarui seluruh daftar siswa dan menjawab jumlah", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    const jawab = await ubahSesi(id, [
      { siswa_ref: A6.siswa1, status: "izin", catatan: "Surat" },
      { siswa_ref: A6.siswa2, status: "sakit", catatan: null },
      { siswa_ref: A6.siswa3, status: "alpa", catatan: null },
    ]);
    expect(jawab).toEqual(expect.objectContaining({ status: 200, badan: { data: { diperbarui: 3 } } }));
    const status = await statusSesi(id);
    expect(status).toEqual([
      { siswa_ref: A6.siswa1, status: "izin", catatan: "Surat" },
      { siswa_ref: A6.siswa2, status: "sakit", catatan: null },
      { siswa_ref: A6.siswa3, status: "alpa", catatan: null },
    ]);
  });

  it("PUT menolak siswa asing, duplikat, payload parsial/kosong, dan payload tidak strict tanpa perubahan", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    const badan = [
      { presensi: [{ siswa_ref: A6.siswaAsing, status: "hadir", catatan: null }] },
      { presensi: [
        { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
        { siswa_ref: A6.siswa1, status: "izin", catatan: null },
      ] },
      { presensi: [{ siswa_ref: A6.siswa1, status: "hadir", catatan: null }] },
      { presensi: [] },
      { presensi: [], tambahan: true },
      { presensi: [{ siswa_ref: "bukan-uuid", status: "hadir", catatan: null }] },
    ];
    for (const satu of badan) {
      const jawab = await panggilJson(app, `/api/sesi/${id}/presensi`, {
        metode: "PUT", sesi: sesiGuruPengampu, badan: satu,
      });
      expect(jawab.status).toBe(400);
    }
    expect((await statusSesi(id)).every((p) => p.status === "alpa")).toBe(true);
  });

  it("PUT ditolak bagi Guru asing, Wali Kelas, Siswa, dan Guru saat rapor final", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    const payload = { presensi: [
      { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
      { siswa_ref: A6.siswa2, status: "alpa", catatan: null },
      { siswa_ref: A6.siswa3, status: "alpa", catatan: null },
    ] };
    for (const sesi of [sesiGuruAsing, sesiGuruWali, sesiSiswa1]) {
      const jawab = await panggilJson(app, `/api/sesi/${id}/presensi`, { metode: "PUT", sesi, badan: payload });
      expect(jawab.status).toBe(403);
    }
    await finalisasiRaporA6();
    const terkunci = await panggilJson(app, `/api/sesi/${id}/presensi`, {
      metode: "PUT", sesi: sesiGuruPengampu, badan: payload,
    });
    expect(terkunci).toMatchObject({ status: 409, badan: { kesalahan: { kode: "RAPOR_TERKUNCI" } } });
    expect((await panggilJson(app, `/api/sesi/${id}/presensi`, { metode: "PUT", sesi: sesiAdmin, badan: payload })).status).toBe(200);
    await kembalikanRaporDraftA6();
  });

  it("PUT rollback seluruh pembaruan ketika baris tengah gagal", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    await pasangPemicuPresensiUji("UPDATE");
    const jawab = await ubahSesi(id, [
      { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
      { siswa_ref: A6.siswa2, status: "izin", catatan: null },
      { siswa_ref: A6.siswa3, status: "alpa", catatan: null },
    ]);
    expect(jawab.status).toBe(500);
    await hapusPemicuPresensiUji();
    expect((await statusSesi(id)).every((p) => p.status === "alpa")).toBe(true);
  });

  it("PUT tidak menjawab sukses palsu ketika tidak ada baris yang terpengaruh", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    await pasangPemicuAbaikanUji("UPDATE", "presensi");
    const jawab = await ubahSesi(id, [
      { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
      { siswa_ref: A6.siswa2, status: "hadir", catatan: null },
      { siswa_ref: A6.siswa3, status: "hadir", catatan: null },
    ]);
    expect(jawab.status).toBe(500);
    await hapusPemicuPresensiUji();
    expect((await statusSesi(id)).every((p) => p.status === "alpa")).toBe(true);
  });

  it("PUT menunggu finalisasi serentak lalu tunduk pada I-22", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    await kembalikanRaporDraftA6();
    const klien = await poolPemilik().connect();
    try {
      await klien.query("BEGIN");
      await klien.query(
        `SELECT id FROM rapor WHERE kelas_ref = $1 AND periode_ref = $2 FOR UPDATE`,
        [A6.kelas, A6.periode],
      );
      const permintaan = ubahSesi(id, [
        { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
        { siswa_ref: A6.siswa2, status: "hadir", catatan: null },
        { siswa_ref: A6.siswa3, status: "hadir", catatan: null },
      ]);
      expect(await selesaiDalam(permintaan, 100)).toBe(false);
      await klien.query(
        `UPDATE rapor
         SET status = 'finalized', difinalisasi_oleh = $3, difinalisasi_pada = now()
         WHERE kelas_ref = $1 AND periode_ref = $2`,
        [A6.kelas, A6.periode, A6.guruPengampu],
      );
      await klien.query("COMMIT");
      expect(await permintaan).toMatchObject({
        status: 409,
        badan: { kesalahan: { kode: "RAPOR_TERKUNCI" } },
      });
      expect((await statusSesi(id)).every((p) => p.status === "alpa")).toBe(true);
    } finally {
      await klien.query("ROLLBACK").catch(() => undefined);
      klien.release();
      await kembalikanRaporDraftA6();
    }
  });

  it("UUID tidak sah dijawab 400 dan sesi yang tidak ada 404", async () => {
    for (const [jalan, status] of [["bukan-uuid", 400], [UUID_TIDAK_ADA, 404]] as const) {
      expect((await panggilJson(app, `/api/sesi/${jalan}`, { sesi: sesiGuruPengampu })).status).toBe(status);
      expect((await panggilJson(app, `/api/sesi/${jalan}/presensi`, { metode: "PUT", sesi: sesiGuruPengampu, badan: { presensi: [] } })).status).toBe(status);
    }
  });
});

describe("DELETE /api/sesi/:id", () => {
  it("menghapus sesi 204 dan presensi ikut cascade — I-16", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    const jawab = await hapusSesi(id);
    expect(jawab.status).toBe(204);
    expect(await jumlahSesi()).toBe(0);
    expect(await jumlahPresensi()).toBe(0);
  });

  it("menolak Guru asing, Wali Kelas, Siswa, UUID salah, dan sesi tak ada", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    for (const sesi of [sesiGuruAsing, sesiGuruWali, sesiSiswa1]) {
      expect((await hapusSesi(id, sesi)).status).toBe(403);
    }
    expect((await hapusSesi("bukan-uuid")).status).toBe(400);
    expect((await hapusSesi(UUID_TIDAK_ADA)).status).toBe(404);
  });

  it("rapor final mengunci Guru tetapi Administrator dapat menghapus — I-22", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    await finalisasiRaporA6();
    expect(await hapusSesi(id)).toMatchObject({ status: 409, badan: { kesalahan: { kode: "RAPOR_TERKUNCI" } } });
    expect((await hapusSesi(id, sesiAdmin)).status).toBe(204);
    await kembalikanRaporDraftA6();
  });

  it("rollback penghapusan sesi ketika cascade presensi gagal", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    await pasangPemicuPresensiUji("DELETE");
    expect((await hapusSesi(id)).status).toBe(500);
    await hapusPemicuPresensiUji();
    expect(await jumlahSesi()).toBe(1);
    expect(await jumlahPresensi()).toBe(3);
  });

  it("DELETE tidak menjawab 204 palsu ketika tidak ada sesi yang terpengaruh", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    await pasangPemicuAbaikanUji("DELETE", "sesi");
    expect((await hapusSesi(id)).status).toBe(500);
    await hapusPemicuPresensiUji();
    expect(await jumlahSesi()).toBe(1);
  });

  it("DELETE menunggu finalisasi serentak lalu tunduk pada I-22", async () => {
    const id = await idSesi(await buatSesi("2026-08-11", []));
    await kembalikanRaporDraftA6();
    const klien = await poolPemilik().connect();
    try {
      await klien.query("BEGIN");
      await klien.query(
        `SELECT id FROM rapor WHERE kelas_ref = $1 AND periode_ref = $2 FOR UPDATE`,
        [A6.kelas, A6.periode],
      );
      const permintaan = hapusSesi(id);
      expect(await selesaiDalam(permintaan, 100)).toBe(false);
      await klien.query(
        `UPDATE rapor
         SET status = 'finalized', difinalisasi_oleh = $3, difinalisasi_pada = now()
         WHERE kelas_ref = $1 AND periode_ref = $2`,
        [A6.kelas, A6.periode, A6.guruPengampu],
      );
      await klien.query("COMMIT");
      expect(await permintaan).toMatchObject({
        status: 409,
        badan: { kesalahan: { kode: "RAPOR_TERKUNCI" } },
      });
      expect(await jumlahSesi()).toBe(1);
    } finally {
      await klien.query("ROLLBACK").catch(() => undefined);
      klien.release();
      await kembalikanRaporDraftA6();
    }
  });
});

describe("GET /api/kelas/:id/presensi", () => {
  it("mengembalikan seluruh siswa dan mapel tanpa sesi sebagai null", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A6.kelas}/presensi`, { sesi: sesiGuruWali });
    expect(jawab.status).toBe(200);
    expect(jawab.badan).toEqual({ data: { siswa: [
      { siswa_ref: A6.siswa2, nama: "Siswa Dua", per_mapel: [{ mapel_nama: "Biologi A6", ada_sesi: false, persen: null }] },
      { siswa_ref: A6.siswa1, nama: "Siswa Satu", per_mapel: [{ mapel_nama: "Biologi A6", ada_sesi: false, persen: null }] },
      { siswa_ref: A6.siswa3, nama: "Siswa Tiga", per_mapel: [{ mapel_nama: "Biologi A6", ada_sesi: false, persen: null }] },
    ] } });
  });

  it("menghitung 1/3=33.33, 2/3=66.67; izin dan sakit hadir — I-17, I-18, AC-29", async () => {
    await buatTigaSesi();
    const siswa = dataDari<{ siswa: Array<{ siswa_ref: string; per_mapel: Array<{ persen: number }> }> }>(
      await panggilJson(app, `/api/kelas/${A6.kelas}/presensi`, { sesi: sesiAdmin }),
    ).siswa;
    expect(siswa.find((s) => s.siswa_ref === A6.siswa1)?.per_mapel[0]?.persen).toBe(33.33);
    expect(siswa.find((s) => s.siswa_ref === A6.siswa2)?.per_mapel[0]?.persen).toBe(66.67);
    expect(siswa.find((s) => s.siswa_ref === A6.siswa3)?.per_mapel[0]?.persen).toBe(66.67);
  });

  it("hanya Wali Kelas dan Administrator yang boleh membaca", async () => {
    const [admin, pengampu, asing, siswa] = await Promise.all([
      panggilJson(app, `/api/kelas/${A6.kelas}/presensi`, { sesi: sesiAdmin }),
      panggilJson(app, `/api/kelas/${A6.kelas}/presensi`, { sesi: sesiGuruPengampu }),
      panggilJson(app, `/api/kelas/${A6.kelas}/presensi`, { sesi: sesiGuruAsing }),
      panggilJson(app, `/api/kelas/${A6.kelas}/presensi`, { sesi: sesiSiswa1 }),
    ]);
    expect(admin.status).toBe(200);
    expect(pengampu.status).toBe(403);
    expect(asing.status).toBe(403);
    expect(siswa.status).toBe(403);
  });

  it("UUID kelas tidak sah dijawab 400 dan kelas tak ada 404 bagi Administrator", async () => {
    expect((await panggilJson(app, "/api/kelas/bukan-uuid/presensi", { sesi: sesiAdmin })).status).toBe(400);
    expect((await panggilJson(app, `/api/kelas/${UUID_TIDAK_ADA}/presensi`, { sesi: sesiAdmin })).status).toBe(404);
  });

  it("jumlah kueri tidak bertambah bersama jumlah siswa (tanpa N+1)", async () => {
    const mata = vi.spyOn(poolPemilik(), "query");
    try {
      expect((await panggilJson(app, `/api/kelas/${A6.kelas}/presensi`, { sesi: sesiAdmin })).status).toBe(200);
      const kecil = mata.mock.calls.length;
      mata.mockRestore();
      await poolPemilik().query(
        `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES ($1, $2, $3)`,
        [A6.kelas, A6.siswaAsing, A6.periode],
      );
      const besarMata = vi.spyOn(poolPemilik(), "query");
      try {
        expect((await panggilJson(app, `/api/kelas/${A6.kelas}/presensi`, { sesi: sesiAdmin })).status).toBe(200);
        expect(besarMata.mock.calls.length).toBe(kecil);
        expect(kecil).toBeLessThanOrEqual(7);
      } finally {
        besarMata.mockRestore();
        await poolPemilik().query(`DELETE FROM kelas_siswa WHERE kelas_ref = $1 AND siswa_ref = $2`, [A6.kelas, A6.siswaAsing]);
      }
    } finally {
      if (vi.isMockFunction(poolPemilik().query)) mata.mockRestore();
    }
  });
});

describe("GET /api/saya/presensi", () => {
  it("Siswa hanya menerima periode dan persentase mapel tanpa rincian tanggal — I-25, AC-30", async () => {
    await buatTigaSesi();
    const jawab = await panggilJson(app, "/api/saya/presensi", { sesi: sesiSiswa1 });
    expect(jawab.status).toBe(200);
    expect(jawab.badan).toEqual({ data: {
      periode_nama: "a6-2026/2027 Ganjil",
      mapel: [{ mapel_nama: "Biologi A6", ada_sesi: true, persen: 33.33 }],
    } });
    expect(JSON.stringify(jawab.badan)).not.toContain("tanggal");
    expect(JSON.stringify(jawab.badan)).not.toContain(A6.siswa2);
  });

  it("memilih kelas pada periode aktif, bukan keanggotaan lama", async () => {
    await pasangKeanggotaanLamaSiswa1();
    const jawab = await panggilJson(app, "/api/saya/presensi", { sesi: sesiSiswa1 });
    expect(jawab.status).toBe(200);
    expect(jawab.badan).toMatchObject({
      data: {
        periode_nama: "a6-2026/2027 Ganjil",
        mapel: [{ mapel_nama: "Biologi A6" }],
      },
    });
  });

  it("izin dan sakit dihitung hadir; penyebut tetap seluruh sesi", async () => {
    await buatTigaSesi();
    const jawab = await panggilJson(app, "/api/saya/presensi", { sesi: await masukSebagai(app, "a6-siswa-2") });
    expect(dataDari<{ mapel: Array<{ persen: number }> }>(jawab).mapel[0]?.persen).toBe(66.67);
  });

  it("hapus satu sesi menyesuaikan persen dari 33.33 menjadi 50 — AC-25", async () => {
    const ids = await buatTigaSesi();
    expect(dataDari<{ mapel: Array<{ persen: number }> }>(await panggilJson(app, "/api/saya/presensi", { sesi: sesiSiswa1 })).mapel[0]?.persen).toBe(33.33);
    expect((await hapusSesi(ids[2]!)).status).toBe(204);
    expect(dataDari<{ mapel: Array<{ persen: number }> }>(await panggilJson(app, "/api/saya/presensi", { sesi: sesiSiswa1 })).mapel[0]?.persen).toBe(50);
  });

  it("tanpa sesi mengembalikan ada_sesi=false dan persen=null", async () => {
    const jawab = await panggilJson(app, "/api/saya/presensi", { sesi: sesiSiswa1 });
    expect(jawab.badan).toMatchObject({ data: { mapel: [{ ada_sesi: false, persen: null }] } });
  });

  it("Siswa di luar kelas hanya memperoleh data kosong dan peran lain ditolak", async () => {
    const asing = await panggilJson(app, "/api/saya/presensi", { sesi: sesiSiswaAsing });
    expect(asing).toMatchObject({ status: 200, badan: { data: { periode_nama: null, mapel: [] } } });
    for (const sesi of [sesiAdmin, sesiGuruPengampu, sesiGuruWali]) {
      expect((await panggilJson(app, "/api/saya/presensi", { sesi })).status).toBe(403);
    }
    expect((await panggilJson(app, "/api/saya/presensi")).status).toBe(401);
  });
});

type BarisMasukan = { siswa_ref: string; status: string; catatan: string | null };

function dataDari<T>(jawab: { badan: unknown }): T {
  return (jawab.badan as { data: T }).data;
}

async function selesaiDalam(promise: Promise<unknown>, milidetik: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), milidetik)),
  ]);
}

function buatSesi(tanggal: string, presensi: BarisMasukan[], sesi = sesiGuruPengampu) {
  return panggilJson(app, `/api/penugasan/${A6.penugasan}/sesi`, {
    metode: "POST", sesi, badan: { tanggal, presensi },
  });
}

async function idSesi(jawab: Awaited<ReturnType<typeof buatSesi>>): Promise<string> {
  expect(jawab.status).toBe(201);
  return dataDari<{ sesi: { id: string } }>(jawab).sesi.id;
}

function ubahSesi(id: string, presensi: BarisMasukan[]) {
  return panggilJson(app, `/api/sesi/${id}/presensi`, {
    metode: "PUT", sesi: sesiGuruPengampu, badan: { presensi },
  });
}

function hapusSesi(id: string, sesi = sesiGuruPengampu) {
  return panggilJson(app, `/api/sesi/${id}`, { metode: "DELETE", sesi });
}

async function jumlahSesi(): Promise<number> {
  const hasil = await poolPemilik().query<{ jumlah: string }>(
    `SELECT count(*)::text AS jumlah FROM sesi WHERE penugasan_ref = $1`, [A6.penugasan],
  );
  return Number(hasil.rows[0]?.jumlah ?? 0);
}

async function jumlahPresensi(): Promise<number> {
  const hasil = await poolPemilik().query<{ jumlah: string }>(
    `SELECT count(*)::text AS jumlah FROM presensi p JOIN sesi s ON s.id = p.sesi_ref WHERE s.penugasan_ref = $1`, [A6.penugasan],
  );
  return Number(hasil.rows[0]?.jumlah ?? 0);
}

async function statusSesi(id: string): Promise<Array<{ siswa_ref: string; status: string; catatan: string | null }>> {
  const hasil = await poolPemilik().query(
    `SELECT siswa_ref, status, catatan FROM presensi WHERE sesi_ref = $1 ORDER BY siswa_ref`, [id],
  );
  return hasil.rows as Array<{ siswa_ref: string; status: string; catatan: string | null }>;
}

async function buatTigaSesi(): Promise<string[]> {
  return Promise.all([
    idSesi(await buatSesi("2026-08-11", [
      { siswa_ref: A6.siswa1, status: "hadir", catatan: null },
      { siswa_ref: A6.siswa2, status: "izin", catatan: null },
      { siswa_ref: A6.siswa3, status: "sakit", catatan: null },
    ])),
    idSesi(await buatSesi("2026-08-12", [
      { siswa_ref: A6.siswa1, status: "alpa", catatan: null },
      { siswa_ref: A6.siswa2, status: "sakit", catatan: null },
      { siswa_ref: A6.siswa3, status: "hadir", catatan: null },
    ])),
    idSesi(await buatSesi("2026-08-13", [])),
  ]);
}

async function pasangPemicuPresensiUji(operasi: "INSERT" | "UPDATE" | "DELETE"): Promise<void> {
  await poolPemilik().query(`CREATE OR REPLACE FUNCTION uji_a6_gagal_presensi()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = '${operasi}' AND OLD.siswa_ref = '${A6.siswa2}'::uuid THEN
        RAISE EXCEPTION 'uji a6 fault injection';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END
  $$`);
  // INSERT tidak memiliki OLD; gunakan fungsi khusus agar ekspresi tidak
  // mengakses record yang belum ditetapkan.
  if (operasi === "INSERT") {
    await poolPemilik().query(`CREATE OR REPLACE FUNCTION uji_a6_gagal_presensi()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.siswa_ref = '${A6.siswa2}'::uuid THEN RAISE EXCEPTION 'uji a6 fault injection'; END IF;
        RETURN NEW;
      END
    $$`);
  }
  await poolPemilik().query(`CREATE TRIGGER uji_a6_pemicu_presensi
    BEFORE ${operasi} ON presensi FOR EACH ROW EXECUTE FUNCTION uji_a6_gagal_presensi()`);
}

async function hapusPemicuPresensiUji(): Promise<void> {
  await poolPemilik().query(`DROP TRIGGER IF EXISTS uji_a6_pemicu_presensi ON presensi`);
  await poolPemilik().query(`DROP TRIGGER IF EXISTS uji_a6_abaikan_presensi ON presensi`);
  await poolPemilik().query(`DROP TRIGGER IF EXISTS uji_a6_abaikan_sesi ON sesi`);
  await poolPemilik().query(`DROP FUNCTION IF EXISTS uji_a6_gagal_presensi()`);
  await poolPemilik().query(`DROP FUNCTION IF EXISTS uji_a6_abaikan_baris()`);
}

async function pasangPemicuAbaikanUji(
  operasi: "UPDATE" | "DELETE",
  tabel: "presensi" | "sesi",
): Promise<void> {
  await poolPemilik().query(`CREATE OR REPLACE FUNCTION uji_a6_abaikan_baris()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RETURN NULL;
    END;
    $$`);
  await poolPemilik().query(`CREATE TRIGGER uji_a6_abaikan_${tabel}
    BEFORE ${operasi} ON ${tabel}
    FOR EACH ROW EXECUTE FUNCTION uji_a6_abaikan_baris()`);
}

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
  await pool.query(`DELETE FROM kelas_siswa WHERE kelas_ref = 'a6000000-0000-4000-8000-000000000151'`);
  await pool.query(`DELETE FROM kelas WHERE id = 'a6000000-0000-4000-8000-000000000151'`);
  await pool.query(`DELETE FROM periode WHERE id = 'a6000000-0000-4000-8000-000000000141'`);
  await pool.query(`DELETE FROM tahun_ajaran WHERE id = 'a6000000-0000-4000-8000-000000000131'`);
  await pool.query(
    `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [A6.kelas, A6.siswa1, A6.periode],
  );
}
