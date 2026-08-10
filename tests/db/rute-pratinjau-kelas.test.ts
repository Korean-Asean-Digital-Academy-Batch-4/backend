import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BATAS_UNGGAH_BYTE } from "../../src/ports/berkas-administrasi.js";
import type { AppUji, JawabanUji } from "./bantuan-rute.js";
import { masukSebagai, nyalakanAppUji } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import { BENIH } from "./benih.js";
import {
  bersihkanDataAdministrasi,
  type BarisFixtureSiswa,
  xlsxSiswa,
} from "./fixture-administrasi.js";

const SEKARANG = new Date("2026-08-10T03:00:00.000Z");
const PERIODE_TIDAK_ADA = "10000000-0000-4000-8000-000000000000";
let app: AppUji;

beforeAll(async () => {
  app = await nyalakanAppUji({ sekarang: () => new Date(SEKARANG) });
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

type PratinjauJson = Readonly<{
  kelas_berkas: string | null;
  cocok: readonly Readonly<{
    baris: number;
    nis: string;
    nama_berkas: string;
    nama_sistem: string;
    siswa_ref: string;
  }>[];
  bermasalah: readonly Readonly<{ baris: number; nis: string; sebab: string }>[];
}>;

function data(jawab: JawabanUji): PratinjauJson {
  return (jawab.badan as { data: PratinjauJson }).data;
}

function formPratinjau(
  periodeRef: string | undefined,
  berkas: Buffer,
  tambahan: Readonly<Record<string, string>> = {},
): FormData {
  const form = new FormData();
  if (periodeRef !== undefined) form.set("periode_ref", periodeRef);
  for (const [nama, nilai] of Object.entries(tambahan)) form.set(nama, nilai);
  form.set(
    "berkas",
    new Blob([berkas], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "daftar-siswa.xlsx",
  );
  return form;
}

async function panggilPratinjau(form: FormData, sesi?: string): Promise<JawabanUji> {
  const jawab = await fetch(`${app.asal}/api/kelas/pratinjau`, {
    method: "POST",
    headers: sesi ? { cookie: sesi } : {},
    body: form,
  });
  return {
    status: jawab.status,
    kepala: jawab.headers,
    badan: await jawab.json(),
  };
}

async function workbook(baris: readonly BarisFixtureSiswa[]): Promise<Buffer> {
  return xlsxSiswa(baris);
}

describe("batas autentikasi dan permintaan pratinjau kelas", () => {
  it("menjawab 401 tanpa sesi dan 403 bagi Guru serta Siswa", async () => {
    const berkas = await workbook([{ kelas: "X IPA 1", nis: "2026002", nama: "Budi" }]);
    const tanpaSesi = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas));
    expect(tanpaSesi.status).toBe(401);
    expect(tanpaSesi.badan).toMatchObject({ kesalahan: { kode: "SESI_TIDAK_SAH" } });

    for (const namaPengguna of ["198001011001", "2026001"]) {
      const sesi = await masukSebagai(app, namaPengguna);
      const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), sesi);
      expect(jawab.status).toBe(403);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KEWENANGAN_DITOLAK" } });
    }
  });

  it("memetakan periode hilang, bukan UUID, berbentuk UUID tetapi tidak ada, dan bidang asing ke 400", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([{ kelas: "X IPA 1", nis: "2026002", nama: "Budi" }]);
    const jawaban = [
      await panggilPratinjau(formPratinjau(undefined, berkas), admin),
      await panggilPratinjau(formPratinjau("bukan-uuid", berkas), admin),
      await panggilPratinjau(formPratinjau(PERIODE_TIDAK_ADA, berkas), admin),
      await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas, { lebih: "ya" }), admin),
    ];

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
  });

  it("menolak multipart tanpa berkas dan nama bidang berkas yang salah", async () => {
    const admin = await masukSebagai(app, "admin");
    const tanpaBerkas = new FormData();
    tanpaBerkas.set("periode_ref", BENIH.periodeGenap);
    const namaSalah = new FormData();
    namaSalah.set("periode_ref", BENIH.periodeGenap);
    namaSalah.set("lampiran", new Blob([Buffer.from("x")]), "daftar-siswa.xlsx");

    const jawaban = await Promise.all([
      panggilPratinjau(tanpaBerkas, admin),
      panggilPratinjau(namaSalah, admin),
    ]);
    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
  });

  it("memetakan workbook rusak ke BERKAS_TIDAK_SAH dan ukuran lebih dari 2 MiB ke 413", async () => {
    const admin = await masukSebagai(app, "admin");
    const rusak = await panggilPratinjau(
      formPratinjau(BENIH.periodeGenap, Buffer.from("bukan xlsx")),
      admin,
    );
    const besar = await panggilPratinjau(
      formPratinjau(BENIH.periodeGenap, Buffer.alloc(BATAS_UNGGAH_BYTE + 1, 1)),
      admin,
    );

    expect(rusak.status).toBe(400);
    expect(rusak.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TIDAK_SAH" } });
    expect(besar.status).toBe(413);
    expect(besar.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TERLALU_BESAR" } });
  });

  it("memprioritaskan periode yang tidak ada atas workbook rusak", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawab = await panggilPratinjau(
      formPratinjau(PERIODE_TIDAK_ADA, Buffer.from("bukan xlsx")),
      admin,
    );

    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
  });
});

describe("pencocokan pratinjau kelas", () => {
  it("mencocokkan siswa pada periode tidak aktif dengan bentuk exact dan tanpa hash", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([{ kelas: "X IPA 1", nis: "2026002", nama: "Budi" }]);
    const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(jawab.status).toBe(200);
    expect(jawab.kepala.get("cache-control")).toBe("no-store");
    expect(data(jawab)).toEqual({
      kelas_berkas: "X IPA 1",
      cocok: [
        {
          baris: 2,
          nis: "2026002",
          nama_berkas: "Budi",
          nama_sistem: "Budi",
          siswa_ref: BENIH.siswaBudi,
        },
      ],
      bermasalah: [],
    });
    expect(JSON.stringify(jawab.badan)).not.toMatch(/kata_sandi|password|hash/i);
  });

  it("mempertahankan perbedaan nama sebagai kecocokan berdampingan", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([
      { kelas: "X IPA 1", nis: "2026002", nama: "Nama Budi dari Berkas" },
    ]);
    const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(jawab.status).toBe(200);
    expect(data(jawab).cocok).toEqual([
      expect.objectContaining({
        nis: "2026002",
        nama_berkas: "Nama Budi dari Berkas",
        nama_sistem: "Budi",
      }),
    ]);
    expect(data(jawab).bermasalah).toEqual([]);
  });

  it("melaporkan NIS tidak dikenal dan nama pengguna Guru sebagai bukan akun siswa", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([
      { kelas: "X IPA 1", nis: "9999999", nama: "Tidak Ada" },
      { kelas: "X IPA 1", nis: "198001011001", nama: "Guru Biologi" },
    ]);
    const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(jawab.status).toBe(200);
    expect(data(jawab).cocok).toEqual([]);
    expect(data(jawab).bermasalah).toEqual([
      { baris: 2, nis: "9999999", sebab: "NIS tidak terdaftar sebagai akun siswa" },
      { baris: 3, nis: "198001011001", sebab: "NIS tidak terdaftar sebagai akun siswa" },
    ]);
  });

  it("mempertahankan kemunculan pertama NIS dan menandai duplikat berikutnya", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([
      { kelas: "X IPA 1", nis: "2026002", nama: "Budi Pertama" },
      { kelas: "X IPA 1", nis: "2026002", nama: "Budi Kedua" },
    ]);
    const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(jawab.status).toBe(200);
    expect(data(jawab).cocok).toEqual([
      expect.objectContaining({ baris: 2, nis: "2026002", nama_berkas: "Budi Pertama" }),
    ]);
    expect(data(jawab).bermasalah).toEqual([
      { baris: 3, nis: "2026002", sebab: "NIS ganda di dalam berkas" },
    ]);
  });

  it("melaporkan I-08 hanya pada periode sasaran", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([{ kelas: "X IPA 1", nis: "2026001", nama: "Andi" }]);
    const ganjil = await panggilPratinjau(formPratinjau(BENIH.periodeGanjil, berkas), admin);
    const genap = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(data(ganjil).cocok).toEqual([]);
    expect(data(ganjil).bermasalah).toEqual([
      {
        baris: 2,
        nis: "2026001",
        sebab: "Sudah terdaftar pada kelas X-1 pada semester ini",
      },
    ]);
    expect(data(genap).cocok).toEqual([
      expect.objectContaining({ baris: 2, nis: "2026001", siswa_ref: BENIH.siswaAndi }),
    ]);
    expect(data(genap).bermasalah).toEqual([]);
  });

  it("menghasilkan kelas null dan rincian terurut untuk Kelas kosong", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([
      { kelas: "", nis: "2026002", nama: "Budi" },
      { kelas: "", nis: "2026001", nama: "Andi" },
    ]);
    const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(jawab.status).toBe(200);
    expect(data(jawab)).toEqual({
      kelas_berkas: null,
      cocok: [],
      bermasalah: [
        { baris: 2, nis: "2026002", sebab: "Kolom Kelas kosong" },
        { baris: 3, nis: "2026001", sebab: "Kolom Kelas kosong" },
      ],
    });
  });

  it("mempertahankan satu nilai Kelas non-kosong sambil melaporkan baris kosong", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([
      { kelas: "X IPA 1", nis: "2026002", nama: "Budi" },
      { kelas: "", nis: "2026001", nama: "Andi" },
    ]);
    const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(jawab.status).toBe(200);
    expect(data(jawab).kelas_berkas).toBe("X IPA 1");
    expect(data(jawab).cocok).toEqual([
      expect.objectContaining({ baris: 2, nis: "2026002", siswa_ref: BENIH.siswaBudi }),
    ]);
    expect(data(jawab).bermasalah).toEqual([
      { baris: 3, nis: "2026001", sebab: "Kolom Kelas kosong" },
    ]);
  });

  it("tidak memilih diam-diam satu nama ketika nilai Kelas bercampur", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([
      { kelas: "X IPA 1", nis: "2026002", nama: "Budi" },
      { kelas: "X IPA 2", nis: "2026001", nama: "Andi" },
    ]);
    const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(jawab.status).toBe(200);
    expect(data(jawab).kelas_berkas).toBeNull();
    expect(data(jawab).cocok).toEqual([]);
    expect(data(jawab).bermasalah).toEqual([
      { baris: 2, nis: "2026002", sebab: "Nilai Kelas tidak konsisten di dalam berkas" },
      { baris: 3, nis: "2026001", sebab: "Nilai Kelas tidak konsisten di dalam berkas" },
    ]);
  });

  it("mendeteksi Kelas berbeda pada baris yang juga gagal validasi parser", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([
      { kelas: "X IPA 1", nis: "2026002", nama: "Budi" },
      { kelas: "X IPA 2", nis: "bukan-angka", nama: "Baris Salah" },
    ]);
    const jawab = await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin);

    expect(jawab.status).toBe(200);
    expect(data(jawab).kelas_berkas).toBeNull();
    expect(data(jawab).cocok).toEqual([]);
    expect(data(jawab).bermasalah).toEqual([
      { baris: 2, nis: "2026002", sebab: "Nilai Kelas tidak konsisten di dalam berkas" },
      {
        baris: 3,
        nis: "bukan-angka",
        sebab: "NIS hanya boleh berisi angka; Nilai Kelas tidak konsisten di dalam berkas",
      },
    ]);
  });
});

describe("efek samping dan pembatas unggah pratinjau", () => {
  it("tidak menulis tabel bisnis meski penghitung dukungan unggah bertambah", async () => {
    const admin = await masukSebagai(app, "admin");
    const sebelum = await hitungTabelBisnis();
    const cocok = await workbook([{ kelas: "X IPA 1", nis: "2026002", nama: "Budi" }]);
    const masalah = await workbook([{ kelas: "X IPA 1", nis: "9999999", nama: "Tidak Ada" }]);

    expect((await panggilPratinjau(formPratinjau(BENIH.periodeGenap, cocok), admin)).status).toBe(
      200,
    );
    expect((await panggilPratinjau(formPratinjau(BENIH.periodeGenap, masalah), admin)).status).toBe(
      200,
    );
    expect(await hitungTabelBisnis()).toEqual(sebelum);
    expect(await jumlahJatahUnggah()).toBe(2);
  });

  it("berbagi jatah unggah dan menolak percobaan kesebelas dengan waktu coba lagi", async () => {
    const admin = await masukSebagai(app, "admin");
    const berkas = await workbook([{ kelas: "X IPA 1", nis: "2026002", nama: "Budi" }]);
    const jawaban: JawabanUji[] = [];
    for (let nomor = 0; nomor < 11; nomor += 1) {
      jawaban.push(await panggilPratinjau(formPratinjau(BENIH.periodeGenap, berkas), admin));
    }

    expect(jawaban.slice(0, 10).map((jawab) => jawab.status)).toEqual(Array(10).fill(200));
    expect(jawaban[10]?.status).toBe(429);
    expect(jawaban[10]?.badan).toMatchObject({
      kesalahan: {
        kode: "BATAS_LAJU_TERLAMPAUI",
        rincian: [{ coba_lagi_pada: expect.any(String) }],
      },
    });
    expect(await jumlahJatahUnggah()).toBe(10);
  });
});

async function hitungTabelBisnis(): Promise<Record<string, number>> {
  const hasil = await poolPemilik().query<{ jumlah: Record<string, number> }>(
    `SELECT jsonb_build_object(
       'pengguna', (SELECT count(*)::int FROM pengguna),
       'guru', (SELECT count(*)::int FROM guru),
       'siswa', (SELECT count(*)::int FROM siswa),
       'tahun_ajaran', (SELECT count(*)::int FROM tahun_ajaran),
       'periode', (SELECT count(*)::int FROM periode),
       'kelas', (SELECT count(*)::int FROM kelas),
       'kelas_siswa', (SELECT count(*)::int FROM kelas_siswa),
       'mapel', (SELECT count(*)::int FROM mapel),
       'penugasan', (SELECT count(*)::int FROM penugasan),
       'komponen_penilaian', (SELECT count(*)::int FROM komponen_penilaian),
       'penugasan_komponen', (SELECT count(*)::int FROM penugasan_komponen),
       'nilai', (SELECT count(*)::int FROM nilai),
       'sesi', (SELECT count(*)::int FROM sesi),
       'presensi', (SELECT count(*)::int FROM presensi),
       'rapor', (SELECT count(*)::int FROM rapor),
       'rapor_mapel', (SELECT count(*)::int FROM rapor_mapel)
     ) AS jumlah`,
  );
  const jumlah = hasil.rows[0]?.jumlah;
  if (!jumlah) throw new Error("Hitungan tabel bisnis tidak tersedia.");
  return jumlah;
}

async function jumlahJatahUnggah(): Promise<number> {
  const hasil = await poolPemilik().query<{ jumlah: number }>(
    `SELECT coalesce(sum(jumlah), 0)::int AS jumlah
     FROM pembatas_laju WHERE kunci LIKE 'unggah:%'`,
  );
  return hasil.rows[0]?.jumlah ?? -1;
}
