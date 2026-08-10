import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AppUji, JawabanUji } from "./bantuan-rute.js";
import { masukSebagai, nyalakanAppUji, panggilJson } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import { BENIH } from "./benih.js";
import { bersihkanDataAdministrasi, pulihkanKomponenAwal } from "./fixture-administrasi.js";

let app: AppUji;

beforeAll(async () => {
  app = await nyalakanAppUji();
});
beforeEach(async () => {
  await hapusPemicuKomponenUji();
  await bersihkanDataAdministrasi();
  await pulihkanKomponenAwal();
});
afterEach(async () => {
  await hapusPemicuKomponenUji();
  await bersihkanDataAdministrasi();
  await pulihkanKomponenAwal();
});
afterAll(async () => {
  try {
    await app.tutup();
  } finally {
    await tutupPool();
  }
});

const mapelSah = Object.freeze({
  kode: "uji-a5-BIO-X",
  nama: "Biologi Lanjutan",
  tingkat: "X",
  guru_ref: BENIH.guruTanpaMapel,
});

type KomponenJson = Readonly<{
  id: string;
  kode: string;
  nama: string;
  bobot: number;
  urutan: number;
}>;

function data<T>(jawab: JawabanUji): T {
  return (jawab.badan as { data: T }).data;
}

async function buatGuru(sufiks: string): Promise<string> {
  const hasil = await poolPemilik().query<{ id: string }>(
    `WITH pengguna_baru AS (
       INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ($1, $2, 'guru', 'x') RETURNING id
     )
     INSERT INTO guru (pengguna_ref)
     SELECT id FROM pengguna_baru RETURNING pengguna_ref AS id`,
    [`uji-a5-guru-${sufiks}`, `Guru Uji ${sufiks}`],
  );
  const id = hasil.rows[0]?.id;
  if (!id) throw new Error("Fixture Guru tidak terbentuk.");
  return id;
}

async function ambilKomponen(sesi: string): Promise<readonly KomponenJson[]> {
  const jawab = await panggilJson(app, "/api/komponen-penilaian", { sesi });
  expect(jawab.status).toBe(200);
  return data<readonly KomponenJson[]>(jawab);
}

function masukanKomponen(komponen: readonly KomponenJson[]): readonly Omit<KomponenJson, "id">[] {
  return komponen.map(({ kode, nama, bobot, urutan }) => ({ kode, nama, bobot, urutan }));
}

describe("batas autentikasi dan validasi mata pelajaran", () => {
  it("menjawab 401 tanpa sesi dan 403 bagi Guru/Siswa pada POST, GET, dan PATCH", async () => {
    const panggilan = [
      () => panggilJson(app, "/api/mapel"),
      () => panggilJson(app, "/api/mapel", { metode: "POST", badan: mapelSah }),
      () =>
        panggilJson(app, `/api/mapel/${BENIH.mapelBio}`, {
          metode: "PATCH",
          badan: { kkm: 80 },
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
        await panggilJson(app, "/api/mapel", { sesi }),
        await panggilJson(app, "/api/mapel", { metode: "POST", sesi, badan: mapelSah }),
        await panggilJson(app, `/api/mapel/${BENIH.mapelBio}`, {
          metode: "PATCH",
          sesi,
          badan: { kkm: 80 },
        }),
      ];
      expect(jawaban.map((jawab) => jawab.status)).toEqual([403, 403, 403]);
      for (const jawab of jawaban) {
        expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KEWENANGAN_DITOLAK" } });
      }
    }
  });

  it("menolak bentuk asing, KKM di luar rentang, dan PATCH tanpa perubahan", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawaban = await Promise.all([
      panggilJson(app, "/api/mapel", {
        metode: "POST",
        sesi: admin,
        badan: { ...mapelSah, tambahan: true },
      }),
      panggilJson(app, "/api/mapel", {
        metode: "POST",
        sesi: admin,
        badan: { ...mapelSah, kkm: -1 },
      }),
      panggilJson(app, "/api/mapel", {
        metode: "POST",
        sesi: admin,
        badan: { ...mapelSah, kkm: 101 },
      }),
      panggilJson(app, "/api/mapel?tambahan=1", { sesi: admin }),
      panggilJson(app, `/api/mapel/${BENIH.mapelBio}`, {
        metode: "PATCH",
        sesi: admin,
        badan: {},
      }),
      panggilJson(app, `/api/mapel/${BENIH.mapelBio}`, {
        metode: "PATCH",
        sesi: admin,
        badan: { tingkat: "XI" },
      }),
      panggilJson(app, "/api/mapel/bukan-uuid", {
        metode: "PATCH",
        sesi: admin,
        badan: { kkm: 80 },
      }),
    ]);

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400, 400, 400, 400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
  });
});

describe("mata pelajaran dan KKM", () => {
  it("membuat mapel dengan KKM default 75 dan bentuk 201 yang persis", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawab = await panggilJson(app, "/api/mapel", {
      metode: "POST",
      sesi: admin,
      badan: mapelSah,
    });

    expect(jawab.status).toBe(201);
    expect(data(jawab)).toEqual({
      id: expect.any(String),
      kode: mapelSah.kode,
      nama: mapelSah.nama,
      tingkat: "X",
      kkm: 75,
      guru: {
        id: BENIH.guruTanpaMapel,
        nama: "Guru Cadangan",
        nama_pengguna: "198001011003",
      },
    });
  });

  it("menerima KKM pada kedua batas 0 dan 100", async () => {
    const admin = await masukSebagai(app, "admin");
    const guruNol = await buatGuru("kkm-0");
    const guruSeratus = await buatGuru("kkm-100");
    const nol = await panggilJson(app, "/api/mapel", {
      metode: "POST",
      sesi: admin,
      badan: { ...mapelSah, kode: "uji-a5-KKM-0", guru_ref: guruNol, kkm: 0 },
    });
    const seratus = await panggilJson(app, "/api/mapel", {
      metode: "POST",
      sesi: admin,
      badan: { ...mapelSah, kode: "uji-a5-KKM-100", guru_ref: guruSeratus, kkm: 100 },
    });

    expect(nol.status).toBe(201);
    expect(data<{ kkm: number }>(nol).kkm).toBe(0);
    expect(seratus.status).toBe(201);
    expect(data<{ kkm: number }>(seratus).kkm).toBe(100);
  });

  it("memetakan kode duplikat dan Guru yang telah mengampu ke kode 409 yang khusus", async () => {
    const admin = await masukSebagai(app, "admin");
    const guru = await buatGuru("duplikat-kode");
    const kodeDuplikat = await panggilJson(app, "/api/mapel", {
      metode: "POST",
      sesi: admin,
      badan: { ...mapelSah, kode: "BIO", guru_ref: guru },
    });
    const guruTerpakai = await panggilJson(app, "/api/mapel", {
      metode: "POST",
      sesi: admin,
      badan: { ...mapelSah, guru_ref: BENIH.guruBio },
    });

    expect(kodeDuplikat.status).toBe(409);
    expect(kodeDuplikat.badan).toMatchObject({ kesalahan: { kode: "DATA_SUDAH_ADA" } });
    expect(guruTerpakai.status).toBe(409);
    expect(guruTerpakai.badan).toMatchObject({
      kesalahan: { kode: "GURU_SUDAH_MENGAMPU" },
    });
  });

  it("menjawab 404 ketika Guru pembuatan atau mapel PATCH tidak ada", async () => {
    const admin = await masukSebagai(app, "admin");
    const tidakAda = "10000000-0000-4000-8000-000000000000";
    const guru = await panggilJson(app, "/api/mapel", {
      metode: "POST",
      sesi: admin,
      badan: { ...mapelSah, guru_ref: tidakAda },
    });
    const mapel = await panggilJson(app, `/api/mapel/${tidakAda}`, {
      metode: "PATCH",
      sesi: admin,
      badan: { nama: "Tidak ada" },
    });

    for (const jawab of [guru, mapel]) {
      expect(jawab.status).toBe(404);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "TIDAK_DITEMUKAN" } });
    }
  });

  it("mengubah hanya nama dan KKM serta mengembalikan bentuk tepat", async () => {
    const admin = await masukSebagai(app, "admin");
    const dibuat = await panggilJson(app, "/api/mapel", {
      metode: "POST",
      sesi: admin,
      badan: mapelSah,
    });
    const mapelRef = data<{ id: string }>(dibuat).id;
    const jawab = await panggilJson(app, `/api/mapel/${mapelRef}`, {
      metode: "PATCH",
      sesi: admin,
      badan: { nama: "Biologi Terapan", kkm: 0 },
    });

    expect(jawab.status).toBe(200);
    expect(data(jawab)).toEqual({
      ...data<Record<string, unknown>>(dibuat),
      nama: "Biologi Terapan",
      kkm: 0,
    });
  });

  it("mendaftar bentuk exact terurut tingkat lalu kode", async () => {
    const admin = await masukSebagai(app, "admin");
    const guru = await buatGuru("daftar");
    await panggilJson(app, "/api/mapel", {
      metode: "POST",
      sesi: admin,
      badan: {
        ...mapelSah,
        kode: "uji-a5-AAA",
        tingkat: "XII",
        guru_ref: guru,
        kkm: 88,
      },
    });
    const jawab = await panggilJson(app, "/api/mapel", { sesi: admin });
    const daftar = data<readonly Record<string, unknown>[]>(jawab);

    expect(jawab.status).toBe(200);
    expect(
      daftar.every(
        (item) => Object.keys(item).sort().join(",") === "guru,id,kkm,kode,nama,tingkat",
      ),
    ).toBe(true);
    expect(daftar.map((item) => `${item.tingkat}:${item.kode}`)).toEqual(
      [...daftar].map((item) => `${item.tingkat}:${item.kode}`).sort((a, b) => a.localeCompare(b)),
    );
    expect(daftar).toContainEqual({
      id: expect.any(String),
      kode: "uji-a5-AAA",
      nama: mapelSah.nama,
      tingkat: "XII",
      kkm: 88,
      guru: {
        id: guru,
        nama: "Guru Uji daftar",
        nama_pengguna: "uji-a5-guru-daftar",
      },
    });
  });
});

describe("komponen penilaian", () => {
  it("GET membutuhkan sesi tetapi tersedia bagi seluruh peran dengan bentuk exact terurut", async () => {
    const tanpaSesi = await panggilJson(app, "/api/komponen-penilaian");
    expect(tanpaSesi.status).toBe(401);

    for (const namaPengguna of ["admin", "198001011001", "2026001"]) {
      const sesi = await masukSebagai(app, namaPengguna);
      const komponen = await ambilKomponen(sesi);
      expect(komponen).toHaveLength(8);
      expect(komponen.map((item) => item.urutan)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(komponen[0]).toEqual({
        id: expect.any(String),
        kode: "T1",
        nama: "Tugas 1",
        bobot: 6,
        urutan: 1,
      });
      expect(
        komponen.every(
          (item) => Object.keys(item).sort().join(",") === "bobot,id,kode,nama,urutan",
        ),
      ).toBe(true);
    }
  });

  it("PUT hanya tersedia bagi Administrator", async () => {
    const komponen = masukanKomponen(await ambilKomponen(await masukSebagai(app, "admin")));
    const tanpaSesi = await panggilJson(app, "/api/komponen-penilaian", {
      metode: "PUT",
      badan: { komponen },
    });
    expect(tanpaSesi.status).toBe(401);
    for (const namaPengguna of ["198001011001", "2026001"]) {
      const sesi = await masukSebagai(app, namaPengguna);
      const jawab = await panggilJson(app, "/api/komponen-penilaian", {
        metode: "PUT",
        sesi,
        badan: { komponen },
      });
      expect(jawab.status).toBe(403);
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "KEWENANGAN_DITOLAK" } });
    }
  });

  it("menolak total 98 dengan teks AC-04 yang persis dan tanpa perubahan", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await ambilKomponen(admin);
    const input = masukanKomponen(lama).map((item, indeks) =>
      indeks === 0 ? { ...item, bobot: item.bobot - 2 } : item,
    );
    const jawab = await panggilJson(app, "/api/komponen-penilaian", {
      metode: "PUT",
      sesi: admin,
      badan: { komponen: input },
    });

    expect(jawab.status).toBe(400);
    expect(jawab.badan).toEqual({
      kesalahan: {
        kode: "BOBOT_TIDAK_SERATUS",
        pesan: "Jumlah bobot komponen penilaian harus tepat 100%, saat ini 98%.",
      },
    });
    expect(await ambilKomponen(admin)).toEqual(lama);
  });

  it("menolak kode, urutan, dan bidang asing yang duplikat tanpa perubahan", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await ambilKomponen(admin);
    const dasar = masukanKomponen(lama);
    const jawaban = [
      await panggilJson(app, "/api/komponen-penilaian", {
        metode: "PUT",
        sesi: admin,
        badan: {
          komponen: dasar.map((item, i) => (i === 1 ? { ...item, kode: dasar[0]!.kode } : item)),
        },
      }),
      await panggilJson(app, "/api/komponen-penilaian", {
        metode: "PUT",
        sesi: admin,
        badan: {
          komponen: dasar.map((item, i) =>
            i === 1 ? { ...item, urutan: dasar[0]!.urutan } : item,
          ),
        },
      }),
      await panggilJson(app, "/api/komponen-penilaian", {
        metode: "PUT",
        sesi: admin,
        badan: { komponen: dasar, tambahan: true },
      }),
    ];

    expect(jawaban.map((jawab) => jawab.status)).toEqual([400, 400, 400]);
    for (const jawab of jawaban) {
      expect(jawab.badan).toMatchObject({ kesalahan: { kode: "PERMINTAAN_TIDAK_SAH" } });
    }
    expect(await ambilKomponen(admin)).toEqual(lama);
  });

  it("mengganti seluruh himpunan kode sebelum templat dipakai", async () => {
    const admin = await masukSebagai(app, "admin");
    const jawab = await panggilJson(app, "/api/komponen-penilaian", {
      metode: "PUT",
      sesi: admin,
      badan: {
        komponen: [
          { kode: "PROYEK", nama: "Proyek", bobot: 40, urutan: 2 },
          { kode: "UJIAN", nama: "Ujian", bobot: 60, urutan: 1 },
        ],
      },
    });

    expect(jawab.status).toBe(200);
    expect(data(jawab)).toEqual([
      { id: expect.any(String), kode: "UJIAN", nama: "Ujian", bobot: 60, urutan: 1 },
      { id: expect.any(String), kode: "PROYEK", nama: "Proyek", bobot: 40, urutan: 2 },
    ]);
  });

  it("setelah dipakai mengubah baris in-place, mempertahankan ID, dan aman menukar urutan", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await ambilKomponen(admin);
    await tandaiKomponenDipakai(lama[0]!.id);
    const input = masukanKomponen(lama).map((item) => {
      if (item.kode === "T1") return { ...item, nama: "Tugas Pertama", bobot: 7, urutan: 2 };
      if (item.kode === "T2") return { ...item, nama: "Tugas Kedua", bobot: 5, urutan: 1 };
      return item;
    });
    const jawab = await panggilJson(app, "/api/komponen-penilaian", {
      metode: "PUT",
      sesi: admin,
      badan: { komponen: input },
    });

    expect(jawab.status).toBe(200);
    const baru = data<readonly KomponenJson[]>(jawab);
    expect(Object.fromEntries(baru.map((item) => [item.kode, item.id]))).toEqual(
      Object.fromEntries(lama.map((item) => [item.kode, item.id])),
    );
    expect(baru.slice(0, 2)).toEqual([
      { ...lama.find((item) => item.kode === "T2")!, nama: "Tugas Kedua", bobot: 5, urutan: 1 },
      { ...lama.find((item) => item.kode === "T1")!, nama: "Tugas Pertama", bobot: 7, urutan: 2 },
    ]);
  });

  it("setelah dipakai menolak penambahan, penghapusan, dan ganti kode tanpa mengubah templat", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await ambilKomponen(admin);
    await tandaiKomponenDipakai(lama[0]!.id);
    const dasar = masukanKomponen(lama);
    const permintaan = [
      [
        ...dasar.map((item, i) => (i === 0 ? { ...item, bobot: item.bobot - 1 } : item)),
        { kode: "BARU", nama: "Baru", bobot: 1, urutan: 9 },
      ],
      dasar
        .slice(1)
        .map((item, i) => (i === 0 ? { ...item, bobot: item.bobot + dasar[0]!.bobot } : item)),
      dasar.map((item, i) => (i === 0 ? { ...item, kode: "T1-BARU" } : item)),
    ] as const;

    for (const komponen of permintaan) {
      const jawab = await panggilJson(app, "/api/komponen-penilaian", {
        metode: "PUT",
        sesi: admin,
        badan: { komponen },
      });
      expect(jawab.status).toBe(409);
      expect(jawab.badan).toMatchObject({
        kesalahan: { kode: "KOMPONEN_SUDAH_DIPAKAI" },
      });
      expect(await ambilKomponen(admin)).toEqual(lama);
    }
  });

  it("menunggu pemakaian konkuren lalu menolak perubahan kode tanpa 500", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await ambilKomponen(admin);
    const koneksi = await poolPemilik().connect();
    let transaksiAktif = false;

    try {
      await koneksi.query("BEGIN");
      transaksiAktif = true;
      await koneksi.query(
        `INSERT INTO penugasan_komponen (penugasan_ref, komponen_ref)
         VALUES ($1, $2)`,
        [BENIH.penugasanBioX1, lama[0]!.id],
      );

      const dasar = masukanKomponen(lama);
      const permintaan = panggilJson(app, "/api/komponen-penilaian", {
        metode: "PUT",
        sesi: admin,
        badan: {
          komponen: dasar.map((item, i) => (i === 0 ? { ...item, kode: "T1-BARU" } : item)),
        },
      });
      await tungguPermintaanKomponenMenungguKunci();
      await koneksi.query("COMMIT");
      transaksiAktif = false;

      const jawab = await permintaan;
      expect(jawab.status).toBe(409);
      expect(jawab.badan).toMatchObject({
        kesalahan: { kode: "KOMPONEN_SUDAH_DIPAKAI" },
      });
      expect(await ambilKomponen(admin)).toEqual(lama);
    } finally {
      if (transaksiAktif) await koneksi.query("ROLLBACK").catch(() => undefined);
      koneksi.release();
    }
  });

  it("menganggap templat sudah dipakai ketika nilai ada tanpa topik penugasan", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await ambilKomponen(admin);
    const administrator = await poolPemilik().query<{ id: string }>(
      `SELECT id FROM pengguna WHERE nama_pengguna = 'uji-a5-administrator'`,
    );
    const administratorRef = administrator.rows[0]?.id;
    if (!administratorRef) throw new Error("Fixture Administrator tidak ditemukan.");
    await poolPemilik().query(
      `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
       VALUES ($1, $2, $3, 80, $4)`,
      [BENIH.penugasanBioX1, lama[0]!.id, BENIH.siswaAndi, administratorRef],
    );

    const dasar = masukanKomponen(lama);
    const jawab = await panggilJson(app, "/api/komponen-penilaian", {
      metode: "PUT",
      sesi: admin,
      badan: {
        komponen: dasar.map((item, i) => (i === 0 ? { ...item, kode: "T1-BARU" } : item)),
      },
    });

    expect(jawab.status).toBe(409);
    expect(jawab.badan).toMatchObject({
      kesalahan: { kode: "KOMPONEN_SUDAH_DIPAKAI" },
    });
    expect(await ambilKomponen(admin)).toEqual(lama);
  });

  it("membatalkan penggantian templat belum dipakai ketika INSERT tengah gagal", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await ambilKomponen(admin);
    await pasangPemicuKomponenUji();
    const jawab = await panggilJson(app, "/api/komponen-penilaian", {
      metode: "PUT",
      sesi: admin,
      badan: {
        komponen: [
          { kode: "PERTAMA", nama: "Pertama", bobot: 40, urutan: 1 },
          { kode: "GAGAL", nama: "Gagal", bobot: 60, urutan: 2 },
        ],
      },
    });

    expect(jawab.status).toBe(500);
    await hapusPemicuKomponenUji();
    expect(await ambilKomponen(admin)).toEqual(lama);
  });

  it("membatalkan seluruh perubahan ketika pembaruan baris tengah gagal", async () => {
    const admin = await masukSebagai(app, "admin");
    const lama = await ambilKomponen(admin);
    await tandaiKomponenDipakai(lama[0]!.id);
    await pasangPemicuKomponenUji();
    const input = masukanKomponen(lama).map((item) => ({ ...item, nama: `${item.nama} baru` }));
    const jawab = await panggilJson(app, "/api/komponen-penilaian", {
      metode: "PUT",
      sesi: admin,
      badan: { komponen: input },
    });

    expect(jawab.status).toBe(500);
    await hapusPemicuKomponenUji();
    expect(await ambilKomponen(admin)).toEqual(lama);
  });
});

async function tandaiKomponenDipakai(komponenRef: string): Promise<void> {
  await poolPemilik().query(
    `INSERT INTO penugasan_komponen (penugasan_ref, komponen_ref)
     VALUES ($1, $2)`,
    [BENIH.penugasanBioX1, komponenRef],
  );
}

async function pasangPemicuKomponenUji(): Promise<void> {
  await poolPemilik().query(`CREATE OR REPLACE FUNCTION uji_a5_gagal_komponen()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (TG_OP = 'UPDATE' AND NEW.kode = 'T2')
         OR (TG_OP = 'INSERT' AND NEW.kode = 'GAGAL')
      THEN RAISE EXCEPTION 'uji a5 fault injection'; END IF;
      RETURN NEW;
    END
  $$`);
  await poolPemilik().query(`CREATE TRIGGER uji_a5_pemicu_komponen
    BEFORE INSERT OR UPDATE ON komponen_penilaian
    FOR EACH ROW EXECUTE FUNCTION uji_a5_gagal_komponen()`);
}

async function hapusPemicuKomponenUji(): Promise<void> {
  await poolPemilik().query(`DROP TRIGGER IF EXISTS uji_a5_pemicu_komponen ON komponen_penilaian`);
  await poolPemilik().query(`DROP FUNCTION IF EXISTS uji_a5_gagal_komponen()`);
}

async function tungguPermintaanKomponenMenungguKunci(): Promise<void> {
  const batas = Date.now() + 3_000;
  while (Date.now() < batas) {
    const hasil = await poolPemilik().query<{ jumlah: string }>(
      `SELECT count(*)::text AS jumlah
       FROM pg_stat_activity
       WHERE pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND query ILIKE '%komponen_penilaian%'`,
    );
    if (Number(hasil.rows[0]?.jumlah ?? 0) > 0) return;
    await new Promise((selesai) => setTimeout(selesai, 20));
  }
  throw new Error("Permintaan komponen tidak terlihat menunggu kunci basis data.");
}
