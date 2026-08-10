import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";

import { kataSandiArgon2id } from "../../src/adapters/local/kata-sandi.js";
import { berkasAdministrasiLokal } from "../../src/adapters/local/berkas-administrasi/index.js";
import { buatBanyakPengguna } from "../../src/db/administrasi/pengguna.js";
import { buatBasisData } from "../../src/db/drizzle.js";
import type { KataSandi } from "../../src/ports/kata-sandi.js";
import type { AppUji, JawabanUji } from "./bantuan-rute.js";
import {
  masukSebagai,
  nyalakanAppUji,
  panggilJson,
  panggilMultipart as panggilMultipartDasar,
} from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import { bersihkanDataAdministrasi, csvAkun, pasangPemicuGagal } from "./fixture-administrasi.js";

const b = inject("benih");
const SEKARANG = new Date("2026-08-09T18:30:00.000Z");
const AWAL_NAMA_PENGGUNA = "99004";
let nomorSandi = 0;
let app: AppUji;

const dasarKataSandi = kataSandiArgon2id();
const kataSandiUji: KataSandi = {
  ...dasarKataSandi,
  buatAwal: () => `AwalUji${String((nomorSandi += 1)).padStart(4, "0")}`,
};

beforeAll(async () => {
  app = await nyalakanAppUji({ kataSandi: kataSandiUji, sekarang: () => new Date(SEKARANG) });
});
beforeEach(async () => {
  nomorSandi = 0;
  await bersihkanDataAdministrasi();
  await bersihkanTask4();
});
afterEach(async () => {
  await bersihkanDataAdministrasi();
  await bersihkanTask4();
});
afterAll(async () => {
  try {
    await app.tutup();
  } finally {
    await tutupPool();
  }
});

function formAkun(
  peran: "guru" | "siswa" | "administrator",
  isi: Buffer,
  tambahan?: Readonly<Record<string, string>>,
): FormData {
  const form = new FormData();
  form.set("peran", peran);
  for (const [nama, nilai] of Object.entries(tambahan ?? {})) form.set(nama, nilai);
  form.set("berkas", new Blob([isi], { type: "text/csv" }), "akun.csv");
  return form;
}

function data(jawab: JawabanUji): Record<string, unknown> {
  return (jawab.badan as { data: Record<string, unknown> }).data;
}

async function panggilMultipart(
  appUji: AppUji,
  jalan: string,
  form: FormData,
  sesi?: string,
): Promise<JawabanUji> {
  if (!sesi) return panggilMultipartDasar(appUji, jalan, form);
  const jawab = await fetch(`${appUji.asal}${jalan}`, {
    method: "POST",
    headers: { cookie: sesi },
    body: form,
  });
  const jenisIsi = jawab.headers.get("content-type") ?? "";
  return {
    status: jawab.status,
    kepala: jawab.headers,
    badan: jenisIsi.includes("application/json")
      ? await jawab.json()
      : Buffer.from(await jawab.arrayBuffer()),
  };
}

async function buatManual(
  sesi: string,
  nomor: string,
  peran: "guru" | "siswa" = "guru",
  nama = `uji-a5-task4-${nomor}`,
): Promise<JawabanUji> {
  return panggilJson(app, "/api/pengguna", {
    metode: "POST",
    sesi,
    badan: { nama, nama_pengguna: `${AWAL_NAMA_PENGGUNA}${nomor}`, peran },
  });
}

async function hitungTask4(): Promise<number> {
  const hasil = await poolPemilik().query<{ jumlah: number }>(
    `SELECT count(*)::int AS jumlah FROM pengguna WHERE nama_pengguna LIKE $1`,
    [`${AWAL_NAMA_PENGGUNA}%`],
  );
  return hasil.rows[0]?.jumlah ?? -1;
}

async function bersihkanTask4(): Promise<void> {
  const pool = poolPemilik();
  await pool.query(
    `DELETE FROM sesi_masuk WHERE pengguna_ref IN
       (SELECT id FROM pengguna WHERE nama_pengguna LIKE $1)`,
    [`${AWAL_NAMA_PENGGUNA}%`],
  );
  await pool.query(
    `DELETE FROM guru WHERE pengguna_ref IN
       (SELECT id FROM pengguna WHERE nama_pengguna LIKE $1)`,
    [`${AWAL_NAMA_PENGGUNA}%`],
  );
  await pool.query(
    `DELETE FROM siswa WHERE pengguna_ref IN
       (SELECT id FROM pengguna WHERE nama_pengguna LIKE $1)`,
    [`${AWAL_NAMA_PENGGUNA}%`],
  );
  await pool.query(`DELETE FROM pengguna WHERE nama_pengguna LIKE $1`, [`${AWAL_NAMA_PENGGUNA}%`]);
}

async function tungguInsertPenggunaTerblokir(): Promise<void> {
  for (let percobaan = 0; percobaan < 100; percobaan += 1) {
    const hasil = await poolPemilik().query<{ ada: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND query LIKE 'insert into "pengguna"%'
       ) AS ada`,
    );
    if (hasil.rows[0]?.ada) return;
    await new Promise((selesai) => setTimeout(selesai, 5));
  }
  throw new Error("Insert pengguna uji tidak mencapai barrier lock.");
}

describe("batas autentikasi dan validasi rute pengguna", () => {
  it("menjawab 401 tanpa sesi dan 403 bagi Guru/Siswa pada keempat endpoint", async () => {
    const guru = await masukSebagai(app, "198001011001");
    const siswa = await masukSebagai(app, "2026001");
    const panggilan = [
      () => panggilJson(app, "/api/pengguna"),
      () =>
        panggilJson(app, "/api/pengguna", {
          metode: "POST",
          badan: { nama: "Uji", nama_pengguna: "990040001", peran: "guru" },
        }),
      () => panggilMultipart(app, "/api/pengguna/unggah", formAkun("guru", csvAkun("guru", []))),
      () => panggilJson(app, `/api/pengguna/${b.guruBio}/kata-sandi`, { metode: "POST" }),
    ] as const;

    for (const panggil of panggilan) {
      const jawab = await panggil();
      expect(jawab.status).toBe(401);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "SESI_TIDAK_SAH" } });
    }

    for (const sesi of [guru, siswa]) {
      const jawaban = [
        await panggilJson(app, "/api/pengguna", { sesi }),
        await panggilJson(app, "/api/pengguna", {
          metode: "POST",
          sesi,
          badan: { nama: "Uji", nama_pengguna: "990040001", peran: "guru" },
        }),
        await panggilMultipart(
          app,
          "/api/pengguna/unggah",
          formAkun("guru", csvAkun("guru", [])),
          sesi,
        ),
        await panggilJson(app, `/api/pengguna/${b.guruBio}/kata-sandi`, {
          metode: "POST",
          sesi,
        }),
      ];
      for (const jawab of jawaban) {
        expect(jawab.status).toBe(403);
        expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KEWENANGAN_DITOLAK" } });
      }
    }
  });

  it("menolak bidang tidak dikenal dan peran Administrator pada seluruh batas HTTP", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = [
      await panggilJson(app, "/api/pengguna?lebih=1", { sesi: admin }),
      await panggilJson(app, "/api/pengguna", {
        metode: "POST",
        sesi: admin,
        badan: { nama: "Uji", nama_pengguna: "990040001", peran: "guru", lebih: true },
      }),
      await panggilJson(app, "/api/pengguna", {
        metode: "POST",
        sesi: admin,
        badan: { nama: "Uji", nama_pengguna: "990040001", peran: "administrator" },
      }),
      await panggilJson(app, `/api/pengguna/${b.guruBio}/kata-sandi`, {
        metode: "POST",
        sesi: admin,
        badan: { lebih: true },
      }),
      await panggilJson(app, `/api/pengguna/${b.guruBio}/kata-sandi`, {
        metode: "POST",
        sesi: admin,
        badan: null,
      }),
      await panggilMultipart(
        app,
        "/api/pengguna/unggah",
        formAkun("guru", csvAkun("guru", []), { lebih: "ya" }),
        admin,
      ),
      await panggilMultipart(
        app,
        "/api/pengguna/unggah",
        formAkun("administrator", csvAkun("guru", [])),
        admin,
      ),
    ];

    expect(
      jawaban.map((jawab) => (jawab.badan as { kesalahan: { kode: string } }).kesalahan.kode),
    ).toEqual([
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
    ]);

    for (const jawab of jawaban) {
      expect(jawab.status).toBe(400);
    }
  });

  it("memetakan seluruh bentuk multipart rusak sebagai permintaan tidak sah", async () => {
    const admin = await masukSebagai(app, "admin");
    const csv = csvAkun("guru", [{ nama: "Uji", namaPengguna: "990040008" }]);
    const duplikatBidang = new FormData();
    duplikatBidang.append("peran", "guru");
    duplikatBidang.append("peran", "siswa");
    duplikatBidang.set("berkas", new Blob([csv], { type: "text/csv" }), "akun.csv");
    const namaBerkasSalah = new FormData();
    namaBerkasSalah.set("peran", "guru");
    namaBerkasSalah.set("lampiran", new Blob([csv], { type: "text/csv" }), "akun.csv");
    const tanpaBerkas = new FormData();
    tanpaBerkas.set("peran", "guru");
    const duaBerkas = new FormData();
    duaBerkas.set("peran", "guru");
    duaBerkas.append("berkas", new Blob([csv], { type: "text/csv" }), "satu.csv");
    duaBerkas.append("berkas", new Blob([csv], { type: "text/csv" }), "dua.csv");

    const jawaban = await Promise.all(
      [duplikatBidang, namaBerkasSalah, tanpaBerkas, duaBerkas].map((form) =>
        panggilMultipart(app, "/api/pengguna/unggah", form, admin),
      ),
    );

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400, 400]);
    expect(
      jawaban.map((jawab) => (jawab.badan as { kesalahan: { kode: string } }).kesalahan.kode),
    ).toEqual([
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
      "PERMINTAAN_TIDAK_SAH",
    ]);
    expect(await hitungTask4()).toBe(0);
  });

  it("menolak nama pengguna manual Guru dan Siswa yang bukan angka", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = await Promise.all(
      [
        { nama: "Guru", nama_pengguna: "nip-abc", peran: "guru" },
        { nama: "Siswa", nama_pengguna: "nis-abc", peran: "siswa" },
      ].map((badan) => panggilJson(app, "/api/pengguna", { metode: "POST", sesi: admin, badan })),
    );

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400]);
    expect(jawaban.map((jawab) => jawab.badan)).toEqual([
      expect.objectContaining({
        kesalahan: expect.objectContaining({ kode: "PERMINTAAN_TIDAK_SAH" }),
      }),
      expect.objectContaining({
        kesalahan: expect.objectContaining({ kode: "PERMINTAAN_TIDAK_SAH" }),
      }),
    ]);
  });
});

describe("akun manual dan daftar", () => {
  it("membuat akun beserta tepat satu profil dan menampilkan kata sandi awal sekali", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawab = await buatManual(admin, "0101", "guru", "uji-a5-task4-Guru Baru");

    expect(jawab.status).toBe(201);
    expect(jawab.kepala.get("cache-control")).toBe("no-store");
    expect(data(jawab)).toMatchObject({
      nama_pengguna: "990040101",
      kata_sandi_awal: "AwalUji0001",
    });
    expect(JSON.stringify(jawab.badan)).not.toMatch(/hash|argon2/i);

    const id = String(data(jawab).id);
    const tersimpan = await poolPemilik().query<{
      nama: string;
      nama_pengguna: string;
      peran: string;
      guru: number;
      siswa: number;
    }>(
      `SELECT p.nama, p.nama_pengguna, p.peran,
              count(g.pengguna_ref)::int AS guru, count(s.pengguna_ref)::int AS siswa
       FROM pengguna p
       LEFT JOIN guru g ON g.pengguna_ref = p.id
       LEFT JOIN siswa s ON s.pengguna_ref = p.id
       WHERE p.id = $1 GROUP BY p.id`,
      [id],
    );
    expect(tersimpan.rows).toEqual([
      {
        nama: "uji-a5-task4-Guru Baru",
        nama_pengguna: "990040101",
        peran: "guru",
        guru: 1,
        siswa: 0,
      },
    ]);
  });

  it("memetakan konflik I-02 tanpa membocorkan pesan constraint PostgreSQL", async () => {
    const admin = await masukSebagai(app, "admin");
    await panggilJson(app, "/api/pengguna", {
      metode: "POST",
      sesi: admin,
      badan: { nama: "uji-a5-task4-awal", nama_pengguna: "990040299", peran: "guru" },
    });
    const jawab = await panggilJson(app, "/api/pengguna", {
      metode: "POST",
      sesi: admin,
      badan: { nama: "uji-a5-task4-dua", nama_pengguna: "990040299", peran: "siswa" },
    });

    expect(jawab.status).toBe(409);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "DATA_SUDAH_ADA" } });
    expect(JSON.stringify(jawab.badan)).not.toMatch(/duplicate|constraint|lower\(|uq_pengguna/i);
  });

  it("mendaftar hanya Guru/Siswa terurut nama tanpa hash", async () => {
    const admin = await masukSebagai(app, "admin");
    await buatManual(admin, "0201", "siswa", "uji-a5-task4-Zeta");
    await buatManual(admin, "0202", "guru", "uji-a5-task4-Alfa");

    const jawab = await panggilJson(app, "/api/pengguna", { sesi: admin });

    expect(jawab.status).toBe(200);
    const daftar = (jawab.badan as { data: Array<Record<string, unknown>> }).data;
    expect(daftar.every((item) => item.peran === "guru" || item.peran === "siswa")).toBe(true);
    expect(daftar.some((item) => item.id === b.admin || item.peran === "administrator")).toBe(
      false,
    );
    expect(JSON.stringify(daftar)).not.toMatch(/kata_sandi|hash|argon2/i);
    expect(daftar.map((item) => item.nama)).toEqual(
      [...daftar.map((item) => item.nama as string)].sort((a, z) => a.localeCompare(z, "id")),
    );
    expect(daftar).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nama: "uji-a5-task4-Alfa", aktif: true }),
        expect.objectContaining({ nama: "uji-a5-task4-Zeta", aktif: true }),
      ]),
    );
  });
});

describe("reset kata sandi", () => {
  it("mengganti hash Guru/Siswa dan mencabut seluruh sesi dalam satu operasi", async () => {
    const admin = await masukSebagai(app, "admin");
    const dibuat = await buatManual(admin, "0301", "siswa");
    const id = String(data(dibuat).id);
    const lama = String(data(dibuat).kata_sandi_awal);
    await panggilJson(app, "/api/auth/masuk", {
      metode: "POST",
      badan: { nama_pengguna: "990040301", kata_sandi: lama },
    });
    await panggilJson(app, "/api/auth/masuk", {
      metode: "POST",
      badan: { nama_pengguna: "990040301", kata_sandi: lama },
    });

    const jawab = await panggilJson(app, `/api/pengguna/${id}/kata-sandi`, {
      metode: "POST",
      sesi: admin,
    });

    expect(jawab.status).toBe(200);
    expect(jawab.kepala.get("cache-control")).toBe("no-store");
    expect(data(jawab)).toEqual({ kata_sandi_awal: "AwalUji0002" });
    const keadaan = await poolPemilik().query<{ kata_sandi_hash: string; sesi: number }>(
      `SELECT p.kata_sandi_hash,
              (SELECT count(*)::int FROM sesi_masuk s WHERE s.pengguna_ref = p.id) AS sesi
       FROM pengguna p WHERE p.id = $1`,
      [id],
    );
    expect(keadaan.rows[0]?.sesi).toBe(0);
    expect(await kataSandiUji.verifikasi(keadaan.rows[0]!.kata_sandi_hash, "AwalUji0002")).toBe(
      true,
    );
    expect(await kataSandiUji.verifikasi(keadaan.rows[0]!.kata_sandi_hash, lama)).toBe(false);
  });

  it("menjawab 404 untuk ID Administrator", async () => {
    const jawab = await panggilJson(app, `/api/pengguna/${b.admin}/kata-sandi`, {
      metode: "POST",
      sesi: await masukSebagai(app, "admin"),
    });

    expect(jawab.status).toBe(404);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "TIDAK_DITEMUKAN" } });
  });

  it("mengembalikan hash dan sesi ketika penghapusan sesi gagal", async () => {
    const admin = await masukSebagai(app, "admin");
    const dibuat = await buatManual(admin, "0302", "guru");
    const id = String(data(dibuat).id);
    const lama = String(data(dibuat).kata_sandi_awal);
    await panggilJson(app, "/api/auth/masuk", {
      metode: "POST",
      badan: { nama_pengguna: "990040302", kata_sandi: lama },
    });
    const sebelum = await poolPemilik().query<{ kata_sandi_hash: string; sesi: number }>(
      `SELECT p.kata_sandi_hash,
              (SELECT count(*)::int FROM sesi_masuk s WHERE s.pengguna_ref = p.id) AS sesi
       FROM pengguna p WHERE p.id = $1`,
      [id],
    );
    const lepas = await pasangPemicuGagal("sesi_masuk");
    const pencatat = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const jawab = await panggilJson(app, `/api/pengguna/${id}/kata-sandi`, {
        metode: "POST",
        sesi: admin,
      });
      expect(jawab.status).toBe(500);
      expect(JSON.stringify(jawab.badan)).not.toMatch(/fault|trigger|postgres|constraint/i);
      const log = JSON.stringify(pencatat.mock.calls);
      expect(log).not.toContain(id);
      expect(log).not.toContain(sebelum.rows[0]!.kata_sandi_hash);
      expect(log).not.toContain("params:");
      expect(pencatat).toHaveBeenCalledWith(
        "unhandled request error",
        expect.objectContaining({ sumber: "postgres", code: "P0001" }),
      );
    } finally {
      pencatat.mockRestore();
      await lepas();
    }
    const sesudah = await poolPemilik().query<{ kata_sandi_hash: string; sesi: number }>(
      `SELECT p.kata_sandi_hash,
              (SELECT count(*)::int FROM sesi_masuk s WHERE s.pengguna_ref = p.id) AS sesi
       FROM pengguna p WHERE p.id = $1`,
      [id],
    );
    expect(sesudah.rows).toEqual(sebelum.rows);
  });
});

describe("unggah akun atomik", () => {
  it("melaporkan seluruh baris yang menjadi konflik pada race pasca-preflight", async () => {
    const pengunci = await poolPemilik().connect();
    try {
      await pengunci.query("BEGIN");
      await pengunci.query("LOCK TABLE pengguna IN SHARE MODE");
      const jalan = buatBanyakPengguna(buatBasisData(poolPemilik()), [
        {
          baris: 2,
          nama: "uji-a5-task4-Race Unggah A",
          namaPengguna: "990040410",
          peran: "guru",
          kataSandiHash: "hash-uji",
        },
        {
          baris: 3,
          nama: "uji-a5-task4-Race Unggah B",
          namaPengguna: "990040411",
          peran: "siswa",
          kataSandiHash: "hash-uji",
        },
      ]);
      await tungguInsertPenggunaTerblokir();
      await pengunci.query(
        `INSERT INTO pengguna (nama, nama_pengguna, peran, kata_sandi_hash) VALUES
          ('uji-a5-task4-Race Luar A', '990040410', 'guru', 'hash-luar'),
          ('uji-a5-task4-Race Luar B', '990040411', 'siswa', 'hash-luar')`,
      );
      await pengunci.query("COMMIT");

      const hasil = await jalan;
      expect(hasil.berhasil).toBe(false);
      if (hasil.berhasil) throw new Error("Race seharusnya ditolak.");
      expect(hasil.rincian).toMatchObject([{ baris: 2 }, { baris: 3 }]);
      const unggahan = await poolPemilik().query<{ jumlah: number }>(
        `SELECT count(*)::int AS jumlah FROM pengguna
         WHERE nama IN ('uji-a5-task4-Race Unggah A', 'uji-a5-task4-Race Unggah B')`,
      );
      expect(unggahan.rows).toEqual([{ jumlah: 0 }]);
    } finally {
      await pengunci.query("ROLLBACK").catch(() => undefined);
      pengunci.release();
    }
  });

  it("tidak menyimpan akun ketika pembentukan CSV kredensial gagal", async () => {
    const dasar = berkasAdministrasiLokal();
    const appGagal = await nyalakanAppUji({
      kataSandi: kataSandiUji,
      sekarang: () => new Date(SEKARANG),
      berkasAdministrasi: {
        ...dasar,
        buatCsvKredensial: async (kredensial) => {
          const pertama = kredensial[0]!;
          const galat = new Error(
            `gagal untuk ${pertama.nama}/${pertama.namaPengguna}/${pertama.kataSandiAwal}`,
          ) as Error & { code: string };
          galat.name = `Adapter-${pertama.namaPengguna}`;
          galat.code = pertama.namaPengguna;
          throw galat;
        },
      },
    });
    const pencatat = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const jawab = await panggilMultipart(
        appGagal,
        "/api/pengguna/unggah",
        formAkun("guru", Buffer.from("Nama,NIP\nuji-a5-task4-CSV Gagal,990040409\n")),
        await masukSebagai(appGagal, "admin"),
      );
      expect(jawab.status).toBe(500);
      expect(await hitungTask4()).toBe(0);
      const log = JSON.stringify(pencatat.mock.calls);
      expect(log).not.toContain("uji-a5-task4-CSV Gagal");
      expect(log).not.toContain("990040409");
      expect(log).not.toContain("AwalUji0001");
      expect(pencatat).toHaveBeenCalledWith("unhandled request error", {
        sumber: "aplikasi",
        name: "Error",
      });
    } finally {
      pencatat.mockRestore();
      await appGagal.tutup();
    }
  });

  it("me-roll back baris awal ketika baris berikutnya ditolak constraint", async () => {
    await expect(
      buatBanyakPengguna(buatBasisData(poolPemilik()), [
        {
          baris: 2,
          nama: "uji-a5-task4-Atomik Awal",
          namaPengguna: "990040400",
          peran: "guru",
          kataSandiHash: "hash-uji",
        },
        {
          baris: 3,
          nama: "",
          namaPengguna: "990040499",
          peran: "siswa",
          kataSandiHash: "hash-uji",
        },
      ]),
    ).rejects.toBeDefined();
    expect(await hitungTask4()).toBe(0);
  });

  it("membatalkan seluruh CSV ketika satu baris sudah terdaftar", async () => {
    const sebelum = await hitungTask4();
    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun(
        "guru",
        Buffer.from("Nama,NIP\nuji-a5-task4-Baru,990040401\nDuplikat,198001011001\n"),
      ),
      await masukSebagai(app, "admin"),
    );
    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TIDAK_SAH" } });
    expect(await hitungTask4()).toBe(sebelum);
  });

  it("mengembalikan setiap rincian duplikat dalam berkas dan basis data", async () => {
    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun(
        "siswa",
        Buffer.from(
          "Nama,NIS\nSudah Ada,2026001\nuji-a5-task4-Sama A,990040402\nuji-a5-task4-Sama B,990040402\n",
        ),
      ),
      await masukSebagai(app, "admin"),
    );

    expect(jawab.status).toBe(400);
    const rincian = (jawab.badan as { kesalahan: { rincian: Array<{ baris: number }> } }).kesalahan
      .rincian;
    expect(rincian.map((item) => item.baris)).toEqual([2, 3, 4]);
    expect(await hitungTask4()).toBe(0);
    expect(JSON.stringify(jawab.badan)).not.toMatch(/duplicate|constraint|lower\(|uq_pengguna/i);
  });

  it("tidak menggandakan rincian ketika duplikat berkas juga sudah terdaftar", async () => {
    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun("siswa", Buffer.from("Nama,NIS\nDuplikat A,2026001\nDuplikat B,2026001\n")),
      await masukSebagai(app, "admin"),
    );

    expect(jawab.status).toBe(400);
    const kesalahan = (
      jawab.badan as {
        kesalahan: { pesan: string; rincian: Array<{ baris: number; sebab: string }> };
      }
    ).kesalahan;
    expect(kesalahan.rincian.map((item) => item.baris)).toEqual([2, 3]);
    expect(kesalahan.pesan).toContain("2 dari 2 baris");
  });

  it("tidak membuka transaksi maupun membuat akun ketika satu baris parser buruk", async () => {
    const sebelum = await hitungTask4();
    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun(
        "guru",
        Buffer.from("Nama,NIP\nuji-a5-task4-Benar,990040403\nuji-a5-task4-Buruk,bukan-angka\n"),
      ),
      await masukSebagai(app, "admin"),
    );

    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({
      kesalahan: { kode: "BERKAS_TIDAK_SAH", rincian: [{ baris: 3 }] },
    });
    expect(await hitungTask4()).toBe(sebelum);
  });

  it("menolak nama dan pengenal terlalu panjang sebelum hashing/transaksi", async () => {
    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun(
        "guru",
        Buffer.from(
          `Nama,NIP\n${"N".repeat(129)},990040407\nuji-a5-task4-Panjang,${"9".repeat(33)}\n`,
        ),
      ),
      await masukSebagai(app, "admin"),
    );

    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({
      kesalahan: {
        kode: "BERKAS_TIDAK_SAH",
        rincian: [{ baris: 2 }, { baris: 3 }],
      },
    });
    expect(await hitungTask4()).toBe(0);
  });

  it("menghasilkan CSV kredensial formula-safe dengan kepala dan nama berzona Jakarta", async () => {
    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun("guru", Buffer.from("Nama,NIP\n=2+2,990040404\nuji-a5-task4-Beta,990040405\n")),
      await masukSebagai(app, "admin"),
    );

    expect(jawab.status).toBe(200);
    expect(jawab.kepala.get("cache-control")).toBe("no-store");
    expect(jawab.kepala.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(jawab.kepala.get("content-disposition")).toBe(
      'attachment; filename="kredensial-guru-2026-08-10.csv"',
    );
    const isi = (jawab.badan as Buffer).toString("utf8");
    expect(isi).toMatch(/^nama,nama_pengguna,kata_sandi_awal\n/);
    expect(isi).toContain("'=2+2,990040404,AwalUji0001");
    expect(isi).not.toMatch(/argon2|kata_sandi_hash|\$argon/i);
    expect(await hitungTask4()).toBe(2);
  });

  it("menamai CSV kredensial Siswa dengan peran dan tanggal Jakarta exact", async () => {
    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun("siswa", Buffer.from("Nama,NIS\nuji-a5-task4-Siswa,990040406\n")),
      await masukSebagai(app, "admin"),
    );

    expect(jawab.status).toBe(200);
    expect(jawab.kepala.get("cache-control")).toBe("no-store");
    expect(jawab.kepala.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(jawab.kepala.get("content-disposition")).toBe(
      'attachment; filename="kredensial-siswa-2026-08-10.csv"',
    );
    expect((jawab.badan as Buffer).toString("utf8")).not.toMatch(/hash|argon2/i);
  });

  it("menolak berkas di atas 2 MiB tanpa memprosesnya", async () => {
    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun("guru", Buffer.alloc(2 * 1024 * 1024 + 1, 65)),
      await masukSebagai(app, "admin"),
    );

    expect(jawab.status).toBe(413);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TERLALU_BESAR" } });
    expect(await hitungTask4()).toBe(0);
  });

  it("menolak percobaan unggah ke-11 dengan waktu coba lagi", async () => {
    const admin = await masukSebagai(app, "admin");
    for (let nomor = 1; nomor <= 10; nomor += 1) {
      const jawab = await panggilMultipart(
        app,
        "/api/pengguna/unggah",
        formAkun("guru", Buffer.from("bukan csv")),
        admin,
      );
      expect(jawab.status).toBe(400);
    }

    const jawab = await panggilMultipart(
      app,
      "/api/pengguna/unggah",
      formAkun("guru", Buffer.from("bukan csv")),
      admin,
    );
    expect(jawab.status).toBe(429);
    expect(jawab.badan).toMatchObject({
      kesalahan: {
        kode: "BATAS_LAJU_TERLAMPAUI",
        rincian: [{ coba_lagi_pada: expect.any(String) }],
      },
    });
  });
});
