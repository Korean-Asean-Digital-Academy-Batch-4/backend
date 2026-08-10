import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buatPeriode as simpanPeriode } from "../../src/db/administrasi/periode.js";
import { buatBasisData } from "../../src/db/drizzle.js";
import type { AppUji, JawabanUji } from "./bantuan-rute.js";
import { masukSebagai, nyalakanAppUji, panggilJson } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import {
  bersihkanDataAdministrasi,
  pasangPemicuGagalAktivasiPeriode,
} from "./fixture-administrasi.js";

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

const tahunSah = Object.freeze({
  nama: "uji-a5-2028/2029",
  tgl_mulai: "2028-07-10",
  tgl_selesai: "2029-06-20",
});
const periodeSah = Object.freeze({
  semester: "ganjil",
  tgl_mulai: "2028-07-10",
  tgl_selesai: "2028-12-20",
});

function data(jawab: JawabanUji): Record<string, unknown> {
  return (jawab.badan as { data: Record<string, unknown> }).data;
}

async function buatTahun(sesi: string, nama: string = tahunSah.nama): Promise<JawabanUji> {
  return panggilJson(app, "/api/tahun-ajaran", {
    metode: "POST",
    sesi,
    badan: { ...tahunSah, nama },
  });
}

async function buatPeriode(
  sesi: string,
  tahunRef: string,
  semester: "ganjil" | "genap",
  tglMulai: string,
  tglSelesai: string,
): Promise<JawabanUji> {
  return panggilJson(app, `/api/tahun-ajaran/${tahunRef}/periode`, {
    metode: "POST",
    sesi,
    badan: { semester, tgl_mulai: tglMulai, tgl_selesai: tglSelesai },
  });
}

describe("batas autentikasi dan validasi periode akademik", () => {
  it("menjawab 401 tanpa sesi dan 403 bagi Guru/Siswa pada seluruh endpoint", async () => {
    const panggilan = [
      () => panggilJson(app, "/api/tahun-ajaran"),
      () => panggilJson(app, "/api/tahun-ajaran", { metode: "POST", badan: tahunSah }),
      () =>
        panggilJson(app, "/api/tahun-ajaran/00000000-0000-4000-8000-000000000031/periode", {
          metode: "POST",
          badan: periodeSah,
        }),
      () =>
        panggilJson(app, "/api/periode/00000000-0000-4000-8000-000000000041/aktif", {
          metode: "PATCH",
        }),
    ] as const;

    for (const panggil of panggilan) {
      const jawab = await panggil();
      expect(jawab.status).toBe(401);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "SESI_TIDAK_SAH" } });
    }

    for (const sesi of [
      await masukSebagai(app, "198001011001"),
      await masukSebagai(app, "2026001"),
    ]) {
      const jawaban = [
        await panggilJson(app, "/api/tahun-ajaran", { sesi }),
        await panggilJson(app, "/api/tahun-ajaran", {
          metode: "POST",
          sesi,
          badan: tahunSah,
        }),
        await panggilJson(app, "/api/tahun-ajaran/00000000-0000-4000-8000-000000000031/periode", {
          metode: "POST",
          sesi,
          badan: periodeSah,
        }),
        await panggilJson(app, "/api/periode/00000000-0000-4000-8000-000000000041/aktif", {
          metode: "PATCH",
          sesi,
        }),
      ];
      for (const jawab of jawaban) {
        expect(jawab.status).toBe(403);
        expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KEWENANGAN_DITOLAK" } });
      }
    }
  });

  it("menolak badan, parameter, dan query yang tidak persis sesuai kontrak", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = await Promise.all([
      panggilJson(app, "/api/tahun-ajaran", {
        metode: "POST",
        sesi: admin,
        badan: { ...tahunSah, tambahan: true },
      }),
      panggilJson(app, "/api/tahun-ajaran?tambahan=1", { sesi: admin }),
      panggilJson(app, "/api/tahun-ajaran/bukan-uuid/periode", {
        metode: "POST",
        sesi: admin,
        badan: periodeSah,
      }),
      panggilJson(app, "/api/tahun-ajaran/00000000-0000-4000-8000-000000000031/periode", {
        metode: "POST",
        sesi: admin,
        badan: { ...periodeSah, tambahan: true },
      }),
      panggilJson(app, "/api/periode/bukan-uuid/aktif", { metode: "PATCH", sesi: admin }),
      panggilJson(app, "/api/periode/00000000-0000-4000-8000-000000000041/aktif", {
        metode: "PATCH",
        sesi: admin,
        badan: { tambahan: true },
      }),
    ]);

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400, 400, 400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
  });

  it("menolak tanggal bukan kalender ISO dan rentang yang tidak naik", async () => {
    const admin = await masukSebagai(app, "admin");
    const tahun = await buatTahun(admin);
    const tahunRef = String(data(tahun).id);
    const jawaban = await Promise.all([
      panggilJson(app, "/api/tahun-ajaran", {
        metode: "POST",
        sesi: admin,
        badan: { ...tahunSah, nama: "uji-a5-tanggal-1", tgl_mulai: "2028-02-30" },
      }),
      panggilJson(app, "/api/tahun-ajaran", {
        metode: "POST",
        sesi: admin,
        badan: { ...tahunSah, nama: "uji-a5-tanggal-2", tgl_mulai: "2028-07-10T00:00:00Z" },
      }),
      panggilJson(app, "/api/tahun-ajaran", {
        metode: "POST",
        sesi: admin,
        badan: { ...tahunSah, nama: "uji-a5-rentang-1", tgl_selesai: tahunSah.tgl_mulai },
      }),
      panggilJson(app, "/api/tahun-ajaran", {
        metode: "POST",
        sesi: admin,
        badan: { ...tahunSah, nama: "uji-a5-tahun-nol", tgl_mulai: "0000-01-01" },
      }),
      buatPeriode(admin, tahunRef, "ganjil", "2028-02-30", "2028-12-20"),
      buatPeriode(admin, tahunRef, "ganjil", "2028-07-10", "2028-07-10"),
      buatPeriode(admin, tahunRef, "ganjil", "0000-01-01", "2028-07-10"),
    ]);

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400, 400, 400, 400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
  });
});

describe("tahun ajaran dan periode", () => {
  it("membuat tahun dan periode dengan bentuk respons 201 yang persis", async () => {
    const admin = await masukSebagai(app, "admin");
    const tahun = await buatTahun(admin);

    expect(tahun.status).toBe(201);
    expect(data(tahun)).toEqual({
      id: expect.any(String),
      nama: tahunSah.nama,
      tgl_mulai: tahunSah.tgl_mulai,
      tgl_selesai: tahunSah.tgl_selesai,
      aktif: false,
    });

    const periode = await buatPeriode(
      admin,
      String(data(tahun).id),
      "ganjil",
      "2028-07-10",
      "2028-12-20",
    );
    expect(periode.status).toBe(201);
    expect(data(periode)).toEqual({
      id: expect.any(String),
      tahun_ajaran_ref: data(tahun).id,
      semester: "ganjil",
      tgl_mulai: "2028-07-10",
      tgl_selesai: "2028-12-20",
      aktif: false,
    });
  });

  it("menerima periode di luar rentang tahun karena kontrak tidak melarangnya", async () => {
    const admin = await masukSebagai(app, "admin");
    const tahun = await buatTahun(admin);
    const jawab = await buatPeriode(
      admin,
      String(data(tahun).id),
      "ganjil",
      "2030-01-01",
      "2030-02-01",
    );

    expect(jawab.status).toBe(201);
  });

  it("memetakan duplikat nama tahun dan semester menjadi 409", async () => {
    const admin = await masukSebagai(app, "admin");
    const tahun = await buatTahun(admin);
    const tahunRef = String(data(tahun).id);
    await buatPeriode(admin, tahunRef, "ganjil", "2028-07-10", "2028-12-20");

    const duplikatTahun = await buatTahun(admin);
    const duplikatPeriode = await buatPeriode(
      admin,
      tahunRef,
      "ganjil",
      "2029-01-01",
      "2029-06-01",
    );

    for (const jawab of [duplikatTahun, duplikatPeriode]) {
      expect(jawab.status).toBe(409);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "DATA_SUDAH_ADA" } });
      expect(JSON.stringify(jawab.badan)).not.toMatch(/duplicate|constraint|uq_/i);
    }
  });

  it("menjawab 404 bagi tahun atau periode yang tidak ada", async () => {
    const admin = await masukSebagai(app, "admin");
    const tidakAda = "10000000-0000-4000-8000-000000000000";
    const periode = await buatPeriode(admin, tidakAda, "ganjil", "2028-01-01", "2028-06-01");
    const aktivasi = await panggilJson(app, `/api/periode/${tidakAda}/aktif`, {
      metode: "PATCH",
      sesi: admin,
    });

    for (const jawab of [periode, aktivasi]) {
      expect(jawab.status).toBe(404);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "TIDAK_DITEMUKAN" } });
    }
  });

  it("tetap memetakan 404 ketika tahun dihapus di antara pemeriksaan dan insert", async () => {
    const admin = await masukSebagai(app, "admin");
    const tahun = await buatTahun(admin);
    const tahunRef = String(data(tahun).id);
    const pengunci = await poolPemilik().connect();
    try {
      await pengunci.query("BEGIN");
      await pengunci.query("LOCK TABLE periode IN ACCESS EXCLUSIVE MODE");
      const jalan = simpanPeriode(buatBasisData(poolPemilik()), tahunRef, {
        semester: "ganjil",
        tglMulai: "2028-07-01",
        tglSelesai: "2028-12-01",
      });
      await tungguKueriTerblokir('insert into "periode"', 1);
      await pengunci.query(`DELETE FROM tahun_ajaran WHERE id = $1`, [tahunRef]);
      await pengunci.query("COMMIT");

      expect(await jalan).toEqual({
        berhasil: false,
        jenis: "tidak_ditemukan",
        pesan: "Tahun ajaran tidak ditemukan.",
      });
    } finally {
      await pengunci.query("ROLLBACK").catch(() => undefined);
      pengunci.release();
    }
  });

  it("mendaftar tahun terbaru dahulu dan periode menurut tanggal mulai", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await buatTahun(admin, "uji-a5-2027/2028");
    await poolPemilik().query(
      `UPDATE tahun_ajaran SET tgl_mulai = '2027-07-01', tgl_selesai = '2028-06-30' WHERE id = $1`,
      [data(lama).id],
    );
    const baru = await buatTahun(admin, "uji-a5-2029/2030");
    await poolPemilik().query(
      `UPDATE tahun_ajaran SET tgl_mulai = '2029-07-01', tgl_selesai = '2030-06-30' WHERE id = $1`,
      [data(baru).id],
    );
    await buatPeriode(admin, String(data(baru).id), "genap", "2030-01-01", "2030-06-01");
    await buatPeriode(admin, String(data(baru).id), "ganjil", "2029-07-01", "2029-12-01");

    const jawab = await panggilJson(app, "/api/tahun-ajaran", { sesi: admin });
    expect(jawab.status).toBe(200);
    const daftar = (jawab.badan as { data: Array<Record<string, unknown>> }).data;
    const milikUji = daftar.filter((item) => String(item.nama).startsWith("uji-a5-"));
    expect(milikUji).toEqual([
      {
        id: data(baru).id,
        nama: "uji-a5-2029/2030",
        tgl_mulai: "2029-07-01",
        tgl_selesai: "2030-06-30",
        aktif: false,
        periode: [
          {
            id: expect.any(String),
            semester: "ganjil",
            tgl_mulai: "2029-07-01",
            tgl_selesai: "2029-12-01",
            aktif: false,
          },
          {
            id: expect.any(String),
            semester: "genap",
            tgl_mulai: "2030-01-01",
            tgl_selesai: "2030-06-01",
            aktif: false,
          },
        ],
      },
      {
        id: data(lama).id,
        nama: "uji-a5-2027/2028",
        tgl_mulai: "2027-07-01",
        tgl_selesai: "2028-06-30",
        aktif: false,
        periode: [],
      },
    ]);
  });
});

describe("aktivasi periode atomik I-03", () => {
  it("menonaktifkan sibling dan mengaktifkan target dalam satu transaksi", async () => {
    const admin = await masukSebagai(app, "admin");
    const tahun = await buatTahun(admin);
    const tahunRef = String(data(tahun).id);
    const ganjil = await buatPeriode(admin, tahunRef, "ganjil", "2028-07-01", "2028-12-01");
    const genap = await buatPeriode(admin, tahunRef, "genap", "2029-01-01", "2029-06-01");
    await poolPemilik().query(`UPDATE periode SET aktif = true WHERE id = $1`, [data(ganjil).id]);

    const jawab = await panggilJson(app, `/api/periode/${String(data(genap).id)}/aktif`, {
      metode: "PATCH",
      sesi: admin,
    });

    expect(jawab.status).toBe(204);
    expect(jawab.badan).toEqual(Buffer.alloc(0));
    expect(await statusPeriode(tahunRef)).toEqual([
      { id: data(ganjil).id, aktif: false },
      { id: data(genap).id, aktif: true },
    ]);
  });

  it("mengembalikan perubahan sibling ketika aktivasi target gagal", async () => {
    const admin = await masukSebagai(app, "admin");
    const tahun = await buatTahun(admin);
    const tahunRef = String(data(tahun).id);
    const ganjil = await buatPeriode(admin, tahunRef, "ganjil", "2028-07-01", "2028-12-01");
    const genap = await buatPeriode(admin, tahunRef, "genap", "2029-01-01", "2029-06-01");
    await poolPemilik().query(`UPDATE periode SET aktif = true WHERE id = $1`, [data(ganjil).id]);
    const lepas = await pasangPemicuGagalAktivasiPeriode(String(data(genap).id));
    const pencatat = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const jawab = await panggilJson(app, `/api/periode/${String(data(genap).id)}/aktif`, {
        metode: "PATCH",
        sesi: admin,
      });
      expect(jawab.status).toBe(500);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KESALAHAN_SERVER" } });
    } finally {
      pencatat.mockRestore();
      await lepas();
    }

    expect(await statusPeriode(tahunRef)).toEqual([
      { id: data(ganjil).id, aktif: true },
      { id: data(genap).id, aktif: false },
    ]);
  });

  it("menyerialkan aktivasi target berbeda dan menyisakan tepat satu periode aktif", async () => {
    const admin = await masukSebagai(app, "admin");
    const tahun = await buatTahun(admin);
    const tahunRef = String(data(tahun).id);
    const ganjil = await buatPeriode(admin, tahunRef, "ganjil", "2028-07-01", "2028-12-01");
    const genap = await buatPeriode(admin, tahunRef, "genap", "2029-01-01", "2029-06-01");

    const pengunci = await poolPemilik().connect();
    let jawaban: readonly JawabanUji[];
    try {
      await pengunci.query("BEGIN");
      await pengunci.query(`SELECT id FROM tahun_ajaran WHERE id = $1 FOR UPDATE`, [tahunRef]);
      const berjalan = Promise.all(
        [ganjil, genap].map((target) =>
          panggilJson(app, `/api/periode/${String(data(target).id)}/aktif`, {
            metode: "PATCH",
            sesi: admin,
          }),
        ),
      );
      await tungguKueriTerblokir('from "tahun_ajaran"', 2);
      await pengunci.query("COMMIT");
      jawaban = await berjalan;
    } finally {
      await pengunci.query("ROLLBACK").catch(() => undefined);
      pengunci.release();
    }

    expect(jawaban.map((jawab) => jawab.status)).toEqual([204, 204]);
    const status = await statusPeriode(tahunRef);
    expect(status.filter((item) => item.aktif)).toHaveLength(1);
  });
});

async function statusPeriode(
  tahunRef: string,
): Promise<readonly Readonly<{ id: string; aktif: boolean }>[]> {
  const hasil = await poolPemilik().query<{ id: string; aktif: boolean }>(
    `SELECT id, aktif FROM periode WHERE tahun_ajaran_ref = $1 ORDER BY tgl_mulai`,
    [tahunRef],
  );
  return hasil.rows;
}

async function tungguKueriTerblokir(pola: string, jumlah: number): Promise<void> {
  for (let percobaan = 0; percobaan < 200; percobaan += 1) {
    const hasil = await poolPemilik().query<{ jumlah: number }>(
      `SELECT count(*)::int AS jumlah FROM pg_stat_activity
       WHERE datname = current_database()
         AND wait_event_type = 'Lock'
         AND lower(query) LIKE '%' || lower($1) || '%'`,
      [pola],
    );
    if ((hasil.rows[0]?.jumlah ?? 0) >= jumlah) return;
    await new Promise((selesai) => setTimeout(selesai, 5));
  }
  throw new Error(`Kueri uji tidak mencapai ${jumlah} barrier lock: ${pola}`);
}
