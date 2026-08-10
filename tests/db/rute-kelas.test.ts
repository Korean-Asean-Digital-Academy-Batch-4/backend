import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { kataSandiArgon2id } from "../../src/adapters/local/kata-sandi.js";
import type { AppUji, JawabanUji } from "./bantuan-rute.js";
import { masukSebagai, nyalakanAppUji, panggilJson } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import { BENIH } from "./benih.js";
import {
  bersihkanDataAdministrasi,
  csvAkun,
  type BarisFixtureSiswa,
  xlsxSiswa,
} from "./fixture-administrasi.js";

const SEKARANG = new Date("2026-08-10T03:00:00.000Z");
const PERIODE_TIDAK_ADA = "10000000-0000-4000-8000-000000000000";
const KELAS_TIDAK_ADA = "10000000-0000-4000-8000-000000000099";
const NAMA_KELAS = "uji-a5-route-X IPA 1";
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

type DataKelas = Readonly<{
  periode_ref?: string;
  nama: string;
  tingkat: string;
  jurusan: string;
  guru_ref: readonly string[];
  wali_kelas_ref: string;
  mapel_ref?: string;
  asing?: boolean;
}>;

function dataKelas(pilihan: Partial<DataKelas> = {}): DataKelas {
  return {
    periode_ref: BENIH.periodeGenap,
    nama: NAMA_KELAS,
    tingkat: "X",
    jurusan: "IPA",
    guru_ref: [BENIH.guruBio],
    wali_kelas_ref: BENIH.guruBio,
    ...pilihan,
  };
}

function barisSah(nama = NAMA_KELAS): readonly BarisFixtureSiswa[] {
  return Object.freeze([{ kelas: nama, nis: "2026002", nama: "Budi dari berkas" }]);
}

async function formKelas(
  data: unknown,
  baris: readonly BarisFixtureSiswa[] = barisSah(),
): Promise<FormData> {
  const form = new FormData();
  form.set("data", typeof data === "string" ? data : JSON.stringify(data));
  form.set(
    "berkas",
    new Blob([await xlsxSiswa(baris)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "daftar-siswa.xlsx",
  );
  return form;
}

async function panggilKelas(form: FormData, sesi?: string): Promise<JawabanUji> {
  const jawab = await fetch(`${app.asal}/api/kelas`, {
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

function data<T>(jawab: JawabanUji): T {
  return (jawab.badan as { data: T }).data;
}

describe("batas autentikasi kelas", () => {
  it("menjawab 401 tanpa sesi pada POST, daftar, dan detail", async () => {
    const jawaban = [
      await panggilKelas(await formKelas(dataKelas())),
      await panggilJson(app, "/api/kelas"),
      await panggilJson(app, `/api/kelas/${BENIH.kelasX1}`),
    ];

    expect(jawaban.map((jawab) => jawab.status)).toEqual([401, 401, 401]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "SESI_TIDAK_SAH" } });
    }
  });

  it("menjawab 403 bagi Guru dan Siswa pada POST, daftar, dan detail", async () => {
    for (const namaPengguna of ["198001011001", "2026001"]) {
      const sesi = await masukSebagai(app, namaPengguna);
      const jawaban = [
        await panggilKelas(await formKelas(dataKelas()), sesi),
        await panggilJson(app, "/api/kelas", { sesi }),
        await panggilJson(app, `/api/kelas/${BENIH.kelasX1}`, { sesi }),
      ];
      expect(jawaban.map((jawab) => jawab.status)).toEqual([403, 403, 403]);
      for (const jawab of jawaban) {
        expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KEWENANGAN_DITOLAK" } });
      }
    }
  });
});

describe("validasi multipart pembuatan kelas", () => {
  it("menolak data hilang, JSON rusak, bidang multipart asing, dan berkas hilang", async () => {
    const admin = await masukSebagai(app, "admin");
    const tanpaData = new FormData();
    tanpaData.set("berkas", new Blob([await xlsxSiswa(barisSah())]), "siswa.xlsx");
    const asing = await formKelas(dataKelas());
    asing.set("tambahan", "tidak boleh");
    const tanpaBerkas = new FormData();
    tanpaBerkas.set("data", JSON.stringify(dataKelas()));

    const jawaban = [
      await panggilKelas(tanpaData, admin),
      await panggilKelas(await formKelas("{rusak"), admin),
      await panggilKelas(asing, admin),
      await panggilKelas(tanpaBerkas, admin),
    ];
    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
  });

  it("menerapkan JSON strict dan tidak pernah menerima mapel_ref dari klien", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = await Promise.all([
      panggilKelas(await formKelas(dataKelas({ asing: true })), admin),
      panggilKelas(await formKelas(dataKelas({ mapel_ref: BENIH.mapelBio })), admin),
    ]);

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
  });

  it("menolak periode hilang, bukan UUID, dan UUID yang tidak ada sebagai PERMINTAAN_TIDAK_SAH", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = await Promise.all([
      panggilKelas(await formKelas(dataKelas({ periode_ref: undefined })), admin),
      panggilKelas(await formKelas(dataKelas({ periode_ref: "bukan-uuid" })), admin),
      panggilKelas(await formKelas(dataKelas({ periode_ref: PERIODE_TIDAK_ADA })), admin),
    ]);

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
  });

  it("mewajibkan guru_ref unik dan tidak kosong serta wali berada di dalamnya", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = await Promise.all([
      panggilKelas(await formKelas(dataKelas({ guru_ref: [] })), admin),
      panggilKelas(await formKelas(dataKelas({ guru_ref: [BENIH.guruBio, BENIH.guruBio] })), admin),
      panggilKelas(
        await formKelas(dataKelas({ guru_ref: [BENIH.guruBio], wali_kelas_ref: BENIH.guruFis })),
        admin,
      ),
    ]);

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400]);
  });

  it("hanya menerima tingkat X, XI, atau XII", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawab = await panggilKelas(await formKelas(dataKelas({ tingkat: "IX" })), admin);
    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
  });

  it("menolak kelas XLSX kosong, bercampur, atau berbeda dari data.nama", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = await Promise.all([
      panggilKelas(
        await formKelas(dataKelas(), [{ kelas: "", nis: "2026002", nama: "Budi" }]),
        admin,
      ),
      panggilKelas(
        await formKelas(dataKelas(), [
          { kelas: NAMA_KELAS, nis: "2026002", nama: "Budi" },
          { kelas: "kelas lain", nis: "2026001", nama: "Andi" },
        ]),
        admin,
      ),
      panggilKelas(await formKelas(dataKelas(), barisSah("kelas lain")), admin),
    ]);
    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TIDAK_SAH" } });
    }
  });

  it("menolak seluruh permintaan bila satu siswa tidak cocok atau NIS ganda", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = await Promise.all([
      panggilKelas(
        await formKelas(dataKelas(), [
          ...barisSah(),
          { kelas: NAMA_KELAS, nis: "9999999", nama: "Tidak Ada" },
        ]),
        admin,
      ),
      panggilKelas(
        await formKelas(dataKelas(), [
          ...barisSah(),
          { kelas: NAMA_KELAS, nis: "2026002", nama: "Budi lagi" },
        ]),
        admin,
      ),
    ]);
    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TIDAK_SAH" } });
    }
  });
});

describe("invarian kurikulum pada batas HTTP", () => {
  it("menolak Guru tanpa mapel dengan rincian yang dapat ditindaklanjuti", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawab = await panggilKelas(
      await formKelas(
        dataKelas({
          guru_ref: [BENIH.guruTanpaMapel],
          wali_kelas_ref: BENIH.guruTanpaMapel,
        }),
      ),
      admin,
    );

    expect(jawab.status).toBe(409);
    expect(jawab.badan).toMatchObject({
      kesalahan: {
        kode: "GURU_BELUM_MENGAMPU",
        rincian: [{ guru_ref: BENIH.guruTanpaMapel, guru_nama: "Guru Cadangan" }],
      },
    });
  });

  it("melaporkan jenjang kelas dan mapel ketika keduanya tidak cocok", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawab = await panggilKelas(
      await formKelas(dataKelas({ guru_ref: [BENIH.guruFis], wali_kelas_ref: BENIH.guruFis })),
      admin,
    );

    expect(jawab.status).toBe(409);
    expect(jawab.badan).toMatchObject({
      kesalahan: {
        kode: "JENJANG_TIDAK_COCOK",
        rincian: [
          {
            guru_ref: BENIH.guruFis,
            mapel_nama: "Fisika",
            jenjang_mapel: "XI",
            jenjang_kelas: "X",
          },
        ],
      },
    });
  });

  it("memetakan nama kelas duplikat dalam periode ke 409", async () => {
    const admin = await masukSebagai(app, "admin");
    const pertama = await panggilKelas(await formKelas(dataKelas()), admin);
    const kedua = await panggilKelas(await formKelas(dataKelas()), admin);

    expect(pertama.status).toBe(201);
    expect(kedua.status).toBe(409);
    expect(kedua.badan).toMatchObject({ kesalahan: { kode: "DATA_SUDAH_ADA" } });
  });
});

describe("pembuatan, daftar, dan detail kelas", () => {
  it("mengembalikan bentuk 201 tepat tanpa membocorkan hash", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawab = await panggilKelas(await formKelas(dataKelas()), admin);

    expect(jawab.status).toBe(201);
    expect(data(jawab)).toEqual({
      id: expect.any(String),
      nama: NAMA_KELAS,
      periode_ref: BENIH.periodeGenap,
      jumlah_siswa: 1,
      jumlah_penugasan: 1,
    });
    expect(JSON.stringify(jawab.badan)).not.toMatch(/kata_sandi|password|hash/i);
  });

  it("mendaftar ringkasan exact terurut periode terbaru lalu nama", async () => {
    const admin = await masukSebagai(app, "admin");
    const dibuat = await panggilKelas(await formKelas(dataKelas()), admin);
    const id = data<{ id: string }>(dibuat).id;
    const jawab = await panggilJson(app, "/api/kelas", { sesi: admin });

    expect(jawab.status).toBe(200);
    const daftar = data<readonly Record<string, unknown>[]>(jawab);
    expect(daftar[0]).toEqual({
      id,
      nama: NAMA_KELAS,
      tingkat: "X",
      jurusan: "IPA",
      periode: { id: BENIH.periodeGenap, semester: "genap", tahun_ajaran_nama: "2026/2027" },
      wali_kelas: { id: BENIH.guruBio, nama: "Guru Biologi" },
      jumlah_siswa: 1,
      jumlah_penugasan: 1,
    });
    expect(daftar.map((item) => item.nama)).toEqual([NAMA_KELAS, "X-1", "XI-1"]);
    expect(JSON.stringify(jawab.badan)).not.toMatch(/kata_sandi|password|hash/i);
  });

  it("mengembalikan detail exact dengan siswa menurut nama dan penugasan menurut kode mapel", async () => {
    const admin = await masukSebagai(app, "admin");
    const nama = "uji-a5-route-X IPA detail";
    const dibuat = await panggilKelas(
      await formKelas(dataKelas({ nama }), [
        { kelas: nama, nis: "2026002", nama: "Budi" },
        { kelas: nama, nis: "2026001", nama: "Andi" },
      ]),
      admin,
    );
    const id = data<{ id: string }>(dibuat).id;
    const jawab = await panggilJson(app, `/api/kelas/${id}`, { sesi: admin });

    expect(jawab.status).toBe(200);
    expect(data(jawab)).toEqual({
      id,
      nama,
      tingkat: "X",
      jurusan: "IPA",
      periode: { id: BENIH.periodeGenap, semester: "genap", tahun_ajaran_nama: "2026/2027" },
      wali_kelas: { id: BENIH.guruBio, nama: "Guru Biologi" },
      jumlah_siswa: 2,
      jumlah_penugasan: 1,
      siswa: [
        { id: BENIH.siswaAndi, nama: "Andi", nama_pengguna: "2026001" },
        { id: BENIH.siswaBudi, nama: "Budi", nama_pengguna: "2026002" },
      ],
      penugasan: [
        {
          id: expect.any(String),
          guru: { id: BENIH.guruBio, nama: "Guru Biologi" },
          mapel: {
            id: BENIH.mapelBio,
            kode: "BIO",
            nama: "Biologi",
            tingkat: "X",
            kkm: 75,
          },
        },
      ],
    });
    expect(JSON.stringify(jawab.badan)).not.toMatch(/kata_sandi|password|hash/i);
  });

  it("menjawab 404 untuk detail UUID yang tidak ada dan 400 untuk ID bukan UUID", async () => {
    const admin = await masukSebagai(app, "admin");
    const [tidakAda, tidakSah] = await Promise.all([
      panggilJson(app, `/api/kelas/${KELAS_TIDAK_ADA}`, { sesi: admin }),
      panggilJson(app, "/api/kelas/bukan-uuid", { sesi: admin }),
    ]);
    expect(tidakAda.status).toBe(404);
    expect(tidakAda.badan).toMatchObject({ kesalahan: { kode: "TIDAK_DITEMUKAN" } });
    expect(tidakSah.status).toBe(400);
    expect(tidakSah.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
  });

  it("menjaga jumlah kueri daftar dan detail tetap terikat", async () => {
    const admin = await masukSebagai(app, "admin");
    const dibuat = await panggilKelas(await formKelas(dataKelas()), admin);
    const id = data<{ id: string }>(dibuat).id;
    const mata = vi.spyOn(poolPemilik(), "query");
    try {
      expect((await panggilJson(app, "/api/kelas", { sesi: admin })).status).toBe(200);
      const kueriDaftarKecil = mata.mock.calls.length;
      mata.mockClear();
      expect((await panggilJson(app, `/api/kelas/${id}`, { sesi: admin })).status).toBe(200);
      const kueriDetailKecil = mata.mock.calls.length;

      mata.mockRestore();
      await tambahAnakKelas(id);
      const mataBesar = vi.spyOn(poolPemilik(), "query");
      try {
        expect((await panggilJson(app, "/api/kelas", { sesi: admin })).status).toBe(200);
        const kueriDaftarBesar = mataBesar.mock.calls.length;
        mataBesar.mockClear();
        expect((await panggilJson(app, `/api/kelas/${id}`, { sesi: admin })).status).toBe(200);
        const kueriDetailBesar = mataBesar.mock.calls.length;

        expect(kueriDaftarKecil).toBeLessThanOrEqual(4);
        expect(kueriDetailKecil).toBeLessThanOrEqual(7);
        expect(kueriDaftarBesar).toBe(kueriDaftarKecil);
        expect(kueriDetailBesar).toBe(kueriDetailKecil);
      } finally {
        mataBesar.mockRestore();
      }
    } finally {
      if (vi.isMockFunction(poolPemilik().query)) mata.mockRestore();
    }
  });
});

describe("jatah unggah bersama dan konteks akademik", () => {
  it("menggabungkan percobaan unggah akun, pratinjau, dan kelas dalam jatah sepuluh", async () => {
    const admin = await masukSebagai(app, "admin");
    const formAkun = (): FormData => {
      const form = new FormData();
      form.set("peran", "guru");
      form.set("berkas", new Blob([csvAkun("guru", [])]), "guru.csv");
      return form;
    };
    const formPratinjau = async (): Promise<FormData> => {
      const form = new FormData();
      form.set("periode_ref", BENIH.periodeGenap);
      form.set("berkas", new Blob([await xlsxSiswa(barisSah())]), "siswa.xlsx");
      return form;
    };
    const jawaban: JawabanUji[] = [];
    for (let nomor = 0; nomor < 4; nomor += 1) {
      jawaban.push(await panggilUnggah("/api/pengguna/unggah", formAkun(), admin));
    }
    for (let nomor = 0; nomor < 3; nomor += 1) {
      jawaban.push(await panggilUnggah("/api/kelas/pratinjau", await formPratinjau(), admin));
    }
    for (let nomor = 0; nomor < 3; nomor += 1) {
      jawaban.push(
        await panggilKelas(await formKelas(dataKelas({ tingkat: `tidak-sah-${nomor}` })), admin),
      );
    }

    expect(jawaban).toHaveLength(10);
    expect(jawaban.every((jawab) => jawab.status !== 429)).toBe(true);
    const kesebelas = await panggilUnggah("/api/kelas/pratinjau", await formPratinjau(), admin);
    expect(kesebelas.status).toBe(429);
    expect(kesebelas.badan).toMatchObject({
      kesalahan: {
        kode: "BATAS_LAJU_TERLAMPAUI",
        rincian: [{ coba_lagi_pada: expect.any(String) }],
      },
    });
  });

  it("memperbarui /api/saya hanya bagi Guru yang dipilih dan tidak memberi konteks kepada Siswa lain", async () => {
    const admin = await masukSebagai(app, "admin");
    const terpilih = await buatAkunKonteks("guru-terpilih", "guru", true);
    const guruLain = await buatAkunKonteks("guru-lain", "guru", false);
    const siswaLain = await buatAkunKonteks("siswa-lain", "siswa", false);
    const nama = "uji-a5-route-konteks";
    const dibuat = await panggilKelas(
      await formKelas(
        dataKelas({ guru_ref: [terpilih.id], wali_kelas_ref: terpilih.id, nama }),
        barisSah(nama),
      ),
      admin,
    );
    expect(dibuat.status).toBe(201);

    const [sayaTerpilih, sayaGuruLain, sayaSiswaLain] = await Promise.all([
      panggilJson(app, "/api/saya", { sesi: terpilih.sesi }),
      panggilJson(app, "/api/saya", { sesi: guruLain.sesi }),
      panggilJson(app, "/api/saya", { sesi: siswaLain.sesi }),
    ]);
    expect(data<{ penugasan: unknown[] }>(sayaTerpilih).penugasan).toEqual([
      expect.objectContaining({ kelas_nama: nama, mapel_nama: "Mapel guru-terpilih" }),
    ]);
    expect(data<{ penugasan: unknown[] }>(sayaGuruLain).penugasan).toEqual([]);
    expect(data<{ penugasan: unknown[]; wali_kelas: unknown[] }>(sayaSiswaLain)).toMatchObject({
      penugasan: [],
      wali_kelas: [],
    });
  });
});

async function panggilUnggah(jalan: string, form: FormData, sesi: string): Promise<JawabanUji> {
  const jawab = await fetch(`${app.asal}${jalan}`, {
    method: "POST",
    headers: { cookie: sesi },
    body: form,
  });
  return { status: jawab.status, kepala: jawab.headers, badan: await jawab.json() };
}

async function buatAkunKonteks(
  sufiks: string,
  peran: "guru" | "siswa",
  denganMapel: boolean,
): Promise<Readonly<{ id: string; sesi: string }>> {
  const namaPengguna = `uji-a5-${sufiks}`;
  const kataSandi = "kata-sandi-uji-konteks";
  const hash = await kataSandiArgon2id().hash(kataSandi);
  const hasil = await poolPemilik().query<{ id: string }>(
    `INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [namaPengguna, `Akun ${sufiks}`, peran, hash],
  );
  const id = hasil.rows[0]?.id;
  if (!id) throw new Error("Akun konteks tidak terbentuk.");
  await poolPemilik().query(
    peran === "guru"
      ? `INSERT INTO guru (pengguna_ref) VALUES ($1)`
      : `INSERT INTO siswa (pengguna_ref) VALUES ($1)`,
    [id],
  );
  if (peran === "guru" && denganMapel) {
    await poolPemilik().query(
      `INSERT INTO mapel (kode, nama, tingkat, guru_ref)
       VALUES ($1, $2, 'X', $3)`,
      [`uji-a5-${sufiks}`, `Mapel ${sufiks}`, id],
    );
  }
  const masuk = await panggilJson(app, "/api/auth/masuk", {
    metode: "POST",
    badan: { nama_pengguna: namaPengguna, kata_sandi: kataSandi },
  });
  const token = masuk.kepala.get("set-cookie")?.match(/edutrack_sesi=([^;]+)/)?.[1];
  if (!token) throw new Error("Sesi akun konteks tidak terbentuk.");
  return { id, sesi: `edutrack_sesi=${token}` };
}

async function tambahAnakKelas(kelasRef: string): Promise<void> {
  const hasil = await poolPemilik().query<{ siswa_id: string; guru_id: string; mapel_id: string }>(
    `WITH siswa_baru AS (
       INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ('uji-a5-query-siswa', 'Siswa Query Tambahan', 'siswa', 'hash-uji')
       RETURNING id
     ), profil_siswa AS (
       INSERT INTO siswa (pengguna_ref) SELECT id FROM siswa_baru RETURNING pengguna_ref
     ), guru_baru AS (
       INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ('uji-a5-query-guru', 'Guru Query Tambahan', 'guru', 'hash-uji')
       RETURNING id
     ), profil_guru AS (
       INSERT INTO guru (pengguna_ref) SELECT id FROM guru_baru RETURNING pengguna_ref
     ), mapel_baru AS (
       INSERT INTO mapel (kode, nama, tingkat, guru_ref)
       SELECT 'uji-a5-query-mapel', 'Mapel Query Tambahan', 'X', pengguna_ref FROM profil_guru
       RETURNING id
     )
     SELECT profil_siswa.pengguna_ref AS siswa_id,
            profil_guru.pengguna_ref AS guru_id,
            mapel_baru.id AS mapel_id
     FROM profil_siswa CROSS JOIN profil_guru CROSS JOIN mapel_baru`,
  );
  const anak = hasil.rows[0];
  if (!anak) throw new Error("Fixture anak kelas untuk hitungan kueri tidak terbentuk.");
  await poolPemilik().query(
    `INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref)
     VALUES ($1, $2, $3)`,
    [kelasRef, anak.siswa_id, BENIH.periodeGenap],
  );
  await poolPemilik().query(
    `INSERT INTO penugasan (guru_ref, mapel_ref, kelas_ref, tingkat)
     VALUES ($1, $2, $3, 'X')`,
    [anak.guru_id, anak.mapel_id, kelasRef],
  );
}
