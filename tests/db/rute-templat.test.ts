import readXlsxFile from "read-excel-file/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppUji, JawabanUji } from "./bantuan-rute.js";
import { masukSebagai, nyalakanAppUji, panggilJson } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import { bersihkanDataAdministrasi } from "./fixture-administrasi.js";

let app: AppUji;

beforeAll(async () => {
  app = await nyalakanAppUji();
});
beforeEach(bersihkanDataAdministrasi);
afterEach(bersihkanDataAdministrasi);
afterAll(async () => {
  try {
    await app.tutup();
  } finally {
    await tutupPool();
  }
});

async function panggil(jalan: string, sesi?: string): Promise<JawabanUji> {
  return panggilJson(app, jalan, { sesi });
}

describe("rute templat", () => {
  it("membuat sesi lewat kredensial fixture tanpa mengubah hash benih bersama", async () => {
    const sebelum = await poolPemilik().query<{ nama_pengguna: string; kata_sandi_hash: string }>(
      `SELECT nama_pengguna, kata_sandi_hash FROM pengguna
       WHERE nama_pengguna IN ('admin', '198001011001', '2026001') ORDER BY nama_pengguna`,
    );

    await masukSebagai(app, "admin");
    await masukSebagai(app, "198001011001");
    await masukSebagai(app, "2026001");

    const sesudah = await poolPemilik().query<{ nama_pengguna: string; kata_sandi_hash: string }>(
      `SELECT nama_pengguna, kata_sandi_hash FROM pengguna
       WHERE nama_pengguna IN ('admin', '198001011001', '2026001') ORDER BY nama_pengguna`,
    );
    expect(sesudah.rows).toEqual(sebelum.rows);
  });

  it.each(["/api/templat/pengguna.csv?peran=guru", "/api/templat/daftar-siswa.xlsx"])(
    "menolak %s tanpa sesi",
    async (jalan) => {
      const jawab = await panggil(jalan);
      expect(jawab.status).toBe(401);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "SESI_TIDAK_SAH" } });
    },
  );

  it.each([
    ["198001011001", "/api/templat/pengguna.csv?peran=guru"],
    ["2026001", "/api/templat/pengguna.csv?peran=siswa"],
    ["198001011001", "/api/templat/daftar-siswa.xlsx"],
    ["2026001", "/api/templat/daftar-siswa.xlsx"],
  ])("menolak peran non-Administrator", async (namaPengguna, jalan) => {
    const jawab = await panggil(jalan, await masukSebagai(app, namaPengguna));
    expect(jawab.status).toBe(403);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KEWENANGAN_DITOLAK" } });
  });

  it.each([
    "/api/templat/pengguna.csv",
    "/api/templat/pengguna.csv?peran=",
    "/api/templat/pengguna.csv?peran=administrator",
    "/api/templat/pengguna.csv?peran=GURU",
    "/api/templat/pengguna.csv?peran=guru&peran=siswa",
  ])("menolak query peran yang tidak sah", async (jalan) => {
    const jawab = await panggil(jalan, await masukSebagai(app, "admin"));
    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
  });

  it.each([
    ["guru", "Nama,NIP\n", 'attachment; filename="templat-pengguna-guru.csv"'],
    ["siswa", "Nama,NIS\n", 'attachment; filename="templat-pengguna-siswa.csv"'],
  ])("mengunduh CSV %s dengan kepala dan nama exact", async (peran, isi, disposition) => {
    const jawab = await panggil(
      `/api/templat/pengguna.csv?peran=${peran}`,
      await masukSebagai(app, "admin"),
    );

    expect(jawab.status).toBe(200);
    expect(jawab.kepala.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(jawab.kepala.get("content-disposition")).toBe(disposition);
    expect((jawab.badan as Buffer).toString("utf8")).toBe(isi);
    expect((jawab.badan as Buffer).toString("utf8")).not.toMatch(/hash|password|sandi/i);
  });

  it("mengunduh XLSX satu lembar dengan kepala exact", async () => {
    const jawab = await panggil("/api/templat/daftar-siswa.xlsx", await masukSebagai(app, "admin"));

    expect(jawab.status).toBe(200);
    expect(jawab.kepala.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(jawab.kepala.get("content-disposition")).toBe(
      'attachment; filename="templat-daftar-siswa.xlsx"',
    );
    const lembar = await readXlsxFile(jawab.badan as Buffer);
    expect(lembar).toHaveLength(1);
    expect(lembar[0]?.data).toEqual([["Kelas", "NIS", "Nama"]]);
    expect((jawab.badan as Buffer).includes(Buffer.from("kata_sandi_hash"))).toBe(false);
  });
});
