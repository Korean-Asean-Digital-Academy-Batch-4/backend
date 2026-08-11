import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";

import { kunciBerkasRapor } from "../../src/db/rapor/berkas.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import {
  akarBerkasUji,
  masukSebagai,
  nyalakanAppUji,
  panggilJson,
  type AppUji,
} from "./bantuan-rute.js";
import {
  A7,
  NAMA_MAPEL,
  bersihkanA7,
  bukaSesiPresensi,
  hapusFixtureA7,
  isiNilaiPenuh,
  isiSeluruhNilai,
  komponenA7,
  pasangFixtureA7,
} from "./fixture-a7.js";

/**
 * Rute rapor — API.md sec 8 seluruhnya.
 *
 * Sasaran utamanya lima invarian dan enam kriteria kesiapan A7: I-20, I-21,
 * I-22, I-25 · AC-07, AC-08, AC-09, AC-13, AC-14, AC-32.
 */

let app: AppUji;
let sesiAdmin: string;
let sesiWali: string;
let sesiGuruSatu: string;
let sesiSiswaSatu: string;
let sesiSiswaDua: string;

beforeAll(async () => {
  await pasangFixtureA7();
  app = await nyalakanAppUji();
  sesiAdmin = await masukSebagai(app, "admin");
  sesiWali = await masukSebagai(app, "a7-guru-wali");
  sesiGuruSatu = await masukSebagai(app, "a7-guru-satu");
  sesiSiswaSatu = await masukSebagai(app, "a7-2027001");
  sesiSiswaDua = await masukSebagai(app, "a7-2027002");
}, 120_000);

afterAll(async () => {
  await app?.tutup();
  await hapusFixtureA7();
  await rm(akarBerkasUji(), { recursive: true, force: true });
  await tutupPool();
});

beforeEach(async () => {
  await bersihkanA7();
  await rm(join(akarBerkasUji(), "rapor"), { recursive: true, force: true });
});

/** Menyiapkan kelas sampai siap difinalisasi: seluruh nilai terisi. */
async function siapFinalisasi(): Promise<void> {
  await isiSeluruhNilai();
}

async function finalisasi(sesi = sesiWali) {
  return panggilJson(app, `/api/kelas/${A7.kelas}/rapor/finalisasi`, { metode: "POST", sesi });
}

async function distribusi(sesi = sesiWali) {
  return panggilJson(app, `/api/kelas/${A7.kelas}/rapor/distribusi`, { metode: "POST", sesi });
}

async function raporSiswa(siswaRef: string): Promise<string> {
  const hasil = await poolPemilik().query<{ id: string }>(
    `SELECT id FROM rapor WHERE siswa_ref = $1 AND periode_ref = '${A7.periode}'`,
    [siswaRef],
  );
  return hasil.rows[0]!.id;
}

function amplopKesalahan(badan: unknown): { kode: string; pesan: string; rincian?: unknown[] } {
  return (badan as { kesalahan: { kode: string; pesan: string; rincian?: unknown[] } }).kesalahan;
}

function amplopData<T>(badan: unknown): T {
  return (badan as { data: T }).data;
}

describe("GET /api/kelas/:id/rapor — kesiapan kelas (API sec 8.1)", () => {
  it("menolak permintaan tanpa sesi", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor`);

    expect(jawab.status).toBe(401);
  });

  it("menolak Guru Mata Pelajaran yang bukan Wali Kelas", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor`, { sesi: sesiGuruSatu });

    expect(jawab.status).toBe(403);
    expect(amplopKesalahan(jawab.badan).kode).toBe("KEWENANGAN_DITOLAK");
  });

  it("menolak Siswa", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor`, { sesi: sesiSiswaSatu });

    expect(jawab.status).toBe(403);
  });

  it("menjawab 404 untuk kelas yang tidak ada", async () => {
    const jawab = await panggilJson(app, "/api/kelas/00000000-0000-4000-8000-0000000000ff/rapor", {
      sesi: sesiAdmin,
    });

    expect(jawab.status).toBe(404);
  });

  it("menampilkan kedua mata pelajaran sebagai belum lengkap sebelum nilai diisi", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor`, { sesi: sesiWali });

    expect(jawab.status).toBe(200);
    const data = amplopData<{
      status: string;
      kelengkapan: {
        mapel_nama: string;
        lengkap: boolean;
        nilai_terisi: number;
        nilai_diperlukan: number;
      }[];
      rapor: { siswa_nama: string; status: string; catatan_wali: string | null }[];
    }>(jawab.badan);

    expect(data.status).toBe("draft");
    // Delapan komponen kali dua siswa.
    expect(data.kelengkapan).toEqual([
      { mapel_nama: NAMA_MAPEL.satu, lengkap: false, nilai_terisi: 0, nilai_diperlukan: 16 },
      { mapel_nama: NAMA_MAPEL.dua, lengkap: false, nilai_terisi: 0, nilai_diperlukan: 16 },
    ]);
    expect(data.rapor.map((satu) => satu.siswa_nama)).toEqual(["Ani Sutarno", "Bayu Nugraha"]);
  });

  it("menandai satu mata pelajaran lengkap setelah seluruh selnya terisi", async () => {
    await isiNilaiPenuh(A7.penugasanSatu);

    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor`, { sesi: sesiWali });

    const data = amplopData<{ kelengkapan: { lengkap: boolean; nilai_terisi: number }[] }>(
      jawab.badan,
    );
    expect(data.kelengkapan[0]).toMatchObject({ lengkap: true, nilai_terisi: 16 });
    expect(data.kelengkapan[1]).toMatchObject({ lengkap: false, nilai_terisi: 0 });
  });

  it("dapat dibaca Administrator tanpa batas kelas", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor`, { sesi: sesiAdmin });

    expect(jawab.status).toBe(200);
  });
});

describe("AC-09 Wali Kelas melihat seluruh mata pelajaran tanpa dapat mengubahnya", () => {
  it("mengizinkan Wali Kelas membaca nilai seluruh kelas", async () => {
    await isiSeluruhNilai();

    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/nilai`, { sesi: sesiWali });

    expect(jawab.status).toBe(200);
    const data = amplopData<{ mapelNama: string }[]>(jawab.badan);
    expect(data).toHaveLength(2);
  });

  it("menolak Wali Kelas menyimpan nilai penugasan Guru lain", async () => {
    const komponen = await komponenA7();

    const jawab = await panggilJson(app, `/api/penugasan/${A7.penugasanSatu}/nilai`, {
      metode: "POST",
      sesi: sesiWali,
      badan: { nilai: [{ siswa_ref: A7.siswaSatu, komponen_ref: komponen[0], nilai: 90 }] },
    });

    expect(jawab.status).toBe(403);
  });
});

describe("POST /api/kelas/:id/rapor/finalisasi (API sec 8.3)", () => {
  it("AC-08 — Guru Mata Pelajaran tidak memiliki jalur finalisasi", async () => {
    await siapFinalisasi();

    const jawab = await finalisasi(sesiGuruSatu);

    expect(jawab.status).toBe(403);
    expect(await statusRapor()).toEqual(["draft", "draft"]);
  });

  it("menolak Siswa", async () => {
    await siapFinalisasi();

    const jawab = await finalisasi(sesiSiswaSatu);

    expect(jawab.status).toBe(403);
  });

  it("AC-07 — menolak beserta satu pesan per mata pelajaran yang belum lengkap", async () => {
    const jawab = await finalisasi();

    expect(jawab.status).toBe(409);
    const kesalahan = amplopKesalahan(jawab.badan);
    expect(kesalahan.kode).toBe("MAPEL_BELUM_LENGKAP");
    expect(kesalahan.pesan).toBe(
      "Rapor belum dapat difinalisasi karena 2 mata pelajaran belum lengkap.",
    );
    expect(kesalahan.rincian).toEqual([
      {
        mapel_nama: NAMA_MAPEL.satu,
        pesan: `Data Mapel ${NAMA_MAPEL.satu} belum ada, tolong hubungi guru yang bertanggung jawab.`,
      },
      {
        mapel_nama: NAMA_MAPEL.dua,
        pesan: `Data Mapel ${NAMA_MAPEL.dua} belum ada, tolong hubungi guru yang bertanggung jawab.`,
      },
    ]);
    expect(await statusRapor()).toEqual(["draft", "draft"]);
  });

  it("AC-07 — menyebut hanya mata pelajaran yang masih kurang", async () => {
    await isiNilaiPenuh(A7.penugasanSatu);

    const jawab = await finalisasi();

    const kesalahan = amplopKesalahan(jawab.badan);
    expect(kesalahan.pesan).toBe(
      "Rapor belum dapat difinalisasi karena 1 mata pelajaran belum lengkap.",
    );
    expect(kesalahan.rincian).toHaveLength(1);
  });

  it("I-20 — menolak ketika satu sel saja masih kosong", async () => {
    await isiSeluruhNilai();
    await poolPemilik().query(
      `DELETE FROM nilai WHERE penugasan_ref = '${A7.penugasanDua}' AND siswa_ref = '${A7.siswaDua}'
       AND komponen_ref = (SELECT id FROM komponen_penilaian ORDER BY urutan LIMIT 1)`,
    );

    const jawab = await finalisasi();

    expect(jawab.status).toBe(409);
    expect(amplopKesalahan(jawab.badan).rincian).toHaveLength(1);
  });

  it("memfinalisasi seluruh kelas dan merender berkasnya dalam satu permintaan", async () => {
    await siapFinalisasi();

    const jawab = await finalisasi();

    expect(jawab.status).toBe(200);
    const data = amplopData<{
      difinalisasi: number;
      difinalisasi_pada: string;
      berkas_terender: number;
    }>(jawab.badan);
    expect(data.difinalisasi).toBe(2);
    expect(data.berkas_terender).toBe(2);
    expect(Number.isNaN(Date.parse(data.difinalisasi_pada))).toBe(false);
    expect(await statusRapor()).toEqual(["finalized", "finalized"]);
  });

  it("mencatat siapa yang memfinalisasi beserta waktunya — ck_rapor_finalisasi", async () => {
    await siapFinalisasi();
    await finalisasi();

    const hasil = await poolPemilik().query<{ difinalisasi_oleh: string; ada_waktu: boolean }>(
      `SELECT difinalisasi_oleh, difinalisasi_pada IS NOT NULL AS ada_waktu
       FROM rapor WHERE periode_ref = '${A7.periode}'`,
    );
    for (const baris of hasil.rows) {
      expect(baris.difinalisasi_oleh).toBe(A7.guruWali);
      expect(baris.ada_waktu).toBe(true);
    }
  });

  it("AC-13 — membekukan nilai akhir, kehadiran, dan seluruh komponennya", async () => {
    await isiSeluruhNilai(80);
    // Empat sesi bagi Ani: hadir, izin, sakit, alpa — hanya Alpa mengurangi (I-17).
    await bukaSesiPresensi(A7.penugasanSatu, ["hadir", "izin", "sakit", "alpa"], A7.siswaSatu);

    await finalisasi();

    const beku = await poolPemilik().query<{
      mapel_nama: string;
      kkm: number;
      nilai_akhir: string;
      kehadiran_persen: string;
      snapshot_komponen: { kode: string; nama: string; bobot: number; nilai: number }[];
    }>(
      `SELECT rm.mapel_nama, rm.kkm, rm.nilai_akhir, rm.kehadiran_persen, rm.snapshot_komponen
       FROM rapor_mapel rm
       JOIN rapor r ON r.id = rm.rapor_ref
       WHERE r.siswa_ref = '${A7.siswaSatu}' AND r.periode_ref = '${A7.periode}'
       ORDER BY rm.mapel_nama`,
    );

    expect(beku.rows).toHaveLength(2);
    const satu = beku.rows[0]!;
    expect(satu.mapel_nama).toBe(NAMA_MAPEL.satu);
    expect(Number(satu.nilai_akhir)).toBe(80);
    expect(Number(satu.kehadiran_persen)).toBe(75);
    expect(satu.snapshot_komponen).toHaveLength(8);
    expect(satu.snapshot_komponen[0]).toEqual({ kode: "T1", nama: "Tugas 1", bobot: 6, nilai: 80 });

    // Mata pelajaran tanpa satu pun sesi dicatat hadir penuh, bukan nol persen.
    expect(Number(beku.rows[1]!.kehadiran_persen)).toBe(100);
  });

  it("AC-13 — angka beku tidak ikut berubah ketika nilai sumbernya dikoreksi", async () => {
    await isiSeluruhNilai(80);
    await finalisasi();

    await poolPemilik().query(
      `UPDATE nilai SET nilai = 20 WHERE penugasan_ref = '${A7.penugasanSatu}'`,
    );

    const beku = await poolPemilik().query<{ nilai_akhir: string }>(
      `SELECT rm.nilai_akhir FROM rapor_mapel rm
       JOIN rapor r ON r.id = rm.rapor_ref
       WHERE r.periode_ref = '${A7.periode}' AND rm.mapel_nama = '${NAMA_MAPEL.satu}'`,
    );
    for (const baris of beku.rows) {
      expect(Number(baris.nilai_akhir)).toBe(80);
    }
  });

  it("I-21 — menolak finalisasi kedua kali", async () => {
    await siapFinalisasi();
    await finalisasi();

    const jawab = await finalisasi();

    expect(jawab.status).toBe(409);
    expect(amplopKesalahan(jawab.badan).kode).toBe("RAPOR_TERKUNCI");
  });

  it("menolak kelas yang belum memiliki satu pun siswa", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelasKosong}/rapor/finalisasi`, {
      metode: "POST",
      sesi: sesiAdmin,
    });

    expect(jawab.status).toBe(400);
  });

  it("AC-14 — Guru tidak dapat lagi menyimpan nilai setelah rapor final", async () => {
    await siapFinalisasi();
    await finalisasi();
    const komponen = await komponenA7();

    const jawab = await panggilJson(app, `/api/penugasan/${A7.penugasanSatu}/nilai`, {
      metode: "POST",
      sesi: sesiGuruSatu,
      badan: { nilai: [{ siswa_ref: A7.siswaSatu, komponen_ref: komponen[0], nilai: 95 }] },
    });

    expect(jawab.status).toBe(409);
    expect(amplopKesalahan(jawab.badan).kode).toBe("RAPOR_TERKUNCI");
  });
});

describe("PATCH /api/rapor/:id — catatan wali (API sec 8.2)", () => {
  it("menyimpan catatan selama rapor masih draft", async () => {
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}`, {
      metode: "PATCH",
      sesi: sesiWali,
      badan: { catatan_wali: "Ani menunjukkan perkembangan yang baik." },
    });

    expect(jawab.status).toBe(200);
    expect(amplopData<{ catatan_wali: string }>(jawab.badan).catatan_wali).toBe(
      "Ani menunjukkan perkembangan yang baik.",
    );
  });

  it("menerima penghapusan catatan lewat null", async () => {
    const id = await raporSiswa(A7.siswaSatu);
    await panggilJson(app, `/api/rapor/${id}`, {
      metode: "PATCH",
      sesi: sesiWali,
      badan: { catatan_wali: "sementara" },
    });

    const jawab = await panggilJson(app, `/api/rapor/${id}`, {
      metode: "PATCH",
      sesi: sesiWali,
      badan: { catatan_wali: null },
    });

    expect(jawab.status).toBe(200);
    expect(amplopData<{ catatan_wali: string | null }>(jawab.badan).catatan_wali).toBeNull();
  });

  it("menolak Guru Mata Pelajaran", async () => {
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}`, {
      metode: "PATCH",
      sesi: sesiGuruSatu,
      badan: { catatan_wali: "tidak boleh" },
    });

    expect(jawab.status).toBe(403);
  });

  it("menolak Siswa menulis catatan pada rapornya sendiri", async () => {
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}`, {
      metode: "PATCH",
      sesi: sesiSiswaSatu,
      badan: { catatan_wali: "tidak boleh" },
    });

    expect(jawab.status).toBe(403);
  });

  it("menolak catatan melampaui seribu aksara — ck_rapor_catatan", async () => {
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}`, {
      metode: "PATCH",
      sesi: sesiWali,
      badan: { catatan_wali: "a".repeat(1001) },
    });

    expect(jawab.status).toBe(400);
  });

  it("AC-14 — menolak perubahan catatan setelah rapor final", async () => {
    const id = await raporSiswa(A7.siswaSatu);
    await siapFinalisasi();
    await finalisasi();

    const jawab = await panggilJson(app, `/api/rapor/${id}`, {
      metode: "PATCH",
      sesi: sesiWali,
      badan: { catatan_wali: "terlambat" },
    });

    expect(jawab.status).toBe(409);
    expect(amplopKesalahan(jawab.badan).kode).toBe("RAPOR_TERKUNCI");
  });

  it("menjawab 404 untuk rapor yang tidak ada", async () => {
    const jawab = await panggilJson(app, "/api/rapor/00000000-0000-4000-8000-0000000000ff", {
      metode: "PATCH",
      sesi: sesiAdmin,
      badan: { catatan_wali: null },
    });

    expect(jawab.status).toBe(404);
  });
});

describe("POST /api/kelas/:id/rapor/distribusi (API sec 8.4)", () => {
  it("I-21 — menolak distribusi sebelum finalisasi", async () => {
    const jawab = await distribusi();

    expect(jawab.status).toBe(409);
    expect(await statusRapor()).toEqual(["draft", "draft"]);
  });

  it("mendistribusikan seluruh rapor kelas", async () => {
    await siapFinalisasi();
    await finalisasi();

    const jawab = await distribusi();

    expect(jawab.status).toBe(200);
    expect(amplopData<{ didistribusikan: number }>(jawab.badan).didistribusikan).toBe(2);
    expect(await statusRapor()).toEqual(["distributed", "distributed"]);
  });

  it("menolak distribusi kedua kali", async () => {
    await siapFinalisasi();
    await finalisasi();
    await distribusi();

    const jawab = await distribusi();

    expect(jawab.status).toBe(409);
  });

  it("AC-08 — menolak Guru Mata Pelajaran", async () => {
    await siapFinalisasi();
    await finalisasi();

    const jawab = await distribusi(sesiGuruSatu);

    expect(jawab.status).toBe(403);
  });
});

describe("GET /api/rapor/:id/berkas — unduh per siswa (API sec 8.4)", () => {
  it("menerbitkan tautan berumur pendek bagi Wali Kelas", async () => {
    await siapFinalisasi();
    await finalisasi();
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}/berkas`, { sesi: sesiWali });

    expect(jawab.status).toBe(200);
    const data = amplopData<{ url: string; kedaluwarsa_pada: string }>(jawab.badan);
    expect(data.url).toContain(".pdf");
    // Lima menit — ARCHITECTURE.md sec 11.1.
    const sisa = Date.parse(data.kedaluwarsa_pada) - Date.now();
    expect(sisa).toBeGreaterThan(4 * 60 * 1000);
    expect(sisa).toBeLessThanOrEqual(5 * 60 * 1000 + 5_000);
  });

  it("AC-32 — menolak Guru Mata Pelajaran", async () => {
    await siapFinalisasi();
    await finalisasi();
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}/berkas`, { sesi: sesiGuruSatu });

    expect(jawab.status).toBe(403);
  });

  it("menolak Siswa selama rapor belum didistribusikan", async () => {
    await siapFinalisasi();
    await finalisasi();
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}/berkas`, { sesi: sesiSiswaSatu });

    expect(jawab.status).toBe(403);
  });

  it("mengizinkan Siswa sesudah distribusi", async () => {
    await siapFinalisasi();
    await finalisasi();
    await distribusi();
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}/berkas`, { sesi: sesiSiswaSatu });

    expect(jawab.status).toBe(200);
  });

  it("I-25 — Siswa tidak dapat mengunduh rapor siswa lain", async () => {
    await siapFinalisasi();
    await finalisasi();
    await distribusi();
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}/berkas`, { sesi: sesiSiswaDua });

    expect(jawab.status).toBe(403);
  });

  it("menolak unduh selama rapor belum difinalisasi", async () => {
    const id = await raporSiswa(A7.siswaSatu);

    const jawab = await panggilJson(app, `/api/rapor/${id}/berkas`, { sesi: sesiWali });

    expect(jawab.status).toBe(409);
    expect(amplopKesalahan(jawab.badan).kode).toBe("BERKAS_BELUM_SIAP");
  });

  it("CK-A-07 — merender ulang dari salinan beku ketika berkasnya hilang", async () => {
    await siapFinalisasi();
    await finalisasi();
    const id = await raporSiswa(A7.siswaSatu);
    await rm(join(akarBerkasUji(), kunciBerkasRapor(A7.periode, id)), { force: true });

    const jawab = await panggilJson(app, `/api/rapor/${id}/berkas`, { sesi: sesiAdmin });

    expect(jawab.status).toBe(200);
  });
});

describe("GET /api/kelas/:id/rapor/berkas — unduh sekelas (API sec 8.5)", () => {
  it("AC-32 — menolak Guru Mata Pelajaran", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor/berkas`, {
      sesi: sesiGuruSatu,
    });

    expect(jawab.status).toBe(403);
  });

  it("menolak Siswa", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor/berkas`, {
      sesi: sesiSiswaSatu,
    });

    expect(jawab.status).toBe(403);
  });

  it("menolak selama kelas belum difinalisasi", async () => {
    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor/berkas`, { sesi: sesiWali });

    expect(jawab.status).toBe(409);
    expect(amplopKesalahan(jawab.badan).kode).toBe("BERKAS_BELUM_SIAP");
  });

  it("menyusun satu arsip berisi seluruh rapor kelas", async () => {
    await siapFinalisasi();
    await finalisasi();

    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor/berkas`, { sesi: sesiWali });

    expect(jawab.status).toBe(200);
    const data = amplopData<{ url: string; jumlah_rapor: number }>(jawab.badan);
    expect(data.jumlah_rapor).toBe(2);

    const anggota = await bacaArsip(data.url);
    expect(anggota).toHaveLength(2);
    expect(anggota.some((nama) => nama.startsWith("Ani Sutarno ("))).toBe(true);
    expect(anggota.every((nama) => nama.endsWith(".pdf"))).toBe(true);
  });

  it("tetap menyusun arsip meskipun berkas per siswa sudah dihapus", async () => {
    await siapFinalisasi();
    await finalisasi();
    await rm(join(akarBerkasUji(), "rapor"), { recursive: true, force: true });

    const jawab = await panggilJson(app, `/api/kelas/${A7.kelas}/rapor/berkas`, {
      sesi: sesiAdmin,
    });

    expect(jawab.status).toBe(200);
    expect(await bacaArsip(amplopData<{ url: string }>(jawab.badan).url)).toHaveLength(2);
  });
});

/** Status seluruh rapor kelas fixture, terurut nama siswa. */
async function statusRapor(): Promise<string[]> {
  const hasil = await poolPemilik().query<{ status: string }>(
    `SELECT r.status FROM rapor r
     JOIN pengguna p ON p.id = r.siswa_ref
     WHERE r.periode_ref = '${A7.periode}' ORDER BY p.nama`,
  );
  return hasil.rows.map((baris) => baris.status);
}

/** Nama anggota arsip pada tautan `file://` yang diterbitkan adapter lokal. */
async function bacaArsip(url: string): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const isi = await readFile(fileURLToPath(url));

  return new Promise((selesai, gagal) => {
    yauzl.fromBuffer(isi, { lazyEntries: true }, (galat, zip) => {
      if (galat) return gagal(galat);
      const nama: string[] = [];
      zip.on("entry", (entri: yauzl.Entry) => {
        nama.push(entri.fileName);
        zip.readEntry();
      });
      zip.on("end", () => selesai(nama));
      zip.on("error", gagal);
      zip.readEntry();
    });
  });
}
