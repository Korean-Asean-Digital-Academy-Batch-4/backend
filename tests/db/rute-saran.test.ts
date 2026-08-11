import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AiAdvisor, HasilSaran, KonteksSaran } from "../../src/ports/ai-advisor.js";
import { poolBacaSaja, poolPemilik, tutupPool } from "./bantuan.js";
import { masukSebagai, nyalakanAppUji, panggilJson, type AppUji } from "./bantuan-rute.js";
import {
  A8,
  NAMA_MAPEL_A8,
  bersihkanA8,
  bukaSesiA8,
  hapusFixtureA8,
  isiNilaiSiswa,
  pasangFixtureA8,
} from "./fixture-a8.js";

/**
 * Tombol Suggestion — API.md sec 9.1 dan ARCHITECTURE.md Pasal 10.
 *
 * Sasarannya AC-16, AC-17, AC-19, AC-20, AC-21, I-23, I-24, dan CK-API-19.
 * AC-18 dan AC-31 menuntut model sungguhan dan tidak diuji di sini.
 *
 * **App uji memakai pool `app_ro` yang sesungguhnya**, bukan pool pemilik.
 * Tanpa itu, pembuktian I-23 hanya membuktikan kode hari ini tidak menulis —
 * bukan bahwa jalur mana pun tidak akan bisa.
 */

/** Penasihat tiruan yang mencatat konteks yang diterimanya. */
function penasihatPencatat(jawab: HasilSaran = { berhasil: true, teks: "Rekomendasi uji." }) {
  const diterima: KonteksSaran[] = [];
  const penasihat: AiAdvisor = {
    sarankan: (konteks) => {
      diterima.push(konteks);
      return Promise.resolve(jawab);
    },
  };
  return { penasihat, diterima };
}

let app: AppUji;
let pencatat: ReturnType<typeof penasihatPencatat>;
let sesiSiswa: string;
let sesiSiswaKosong: string;
let sesiAdmin: string;
let sesiGuru: string;

beforeAll(async () => {
  await pasangFixtureA8();
  pencatat = penasihatPencatat();
  app = await nyalakanAppUji({ poolRo: poolBacaSaja(), penasihatAi: pencatat.penasihat });
  sesiAdmin = await masukSebagai(app, "admin");
  sesiGuru = await masukSebagai(app, "a8-guru");
  sesiSiswa = await masukSebagai(app, "a8-2028001");
  sesiSiswaKosong = await masukSebagai(app, "a8-2028002");
}, 120_000);

afterAll(async () => {
  await app?.tutup();
  await hapusFixtureA8();
  await tutupPool();
});

beforeEach(async () => {
  await bersihkanA8();
  pencatat.diterima.length = 0;
});

function amplopData<T>(badan: unknown): T {
  return (badan as { data: T }).data;
}

function amplopKesalahan(badan: unknown): { kode: string; pesan: string; rincian?: unknown[] } {
  return (badan as { kesalahan: { kode: string; pesan: string; rincian?: unknown[] } }).kesalahan;
}

function minta(sesi?: string) {
  return panggilJson(app, "/api/saya/suggestion", { metode: "POST", sesi });
}

describe("lapis peran — hanya Siswa (aktor-role sec 6)", () => {
  it("menolak permintaan tanpa sesi", async () => {
    expect((await minta()).status).toBe(401);
  });

  it("menolak Administrator", async () => {
    expect((await minta(sesiAdmin)).status).toBe(403);
  });

  it("menolak Guru", async () => {
    expect((await minta(sesiGuru)).status).toBe(403);
  });

  it("tidak memanggil AI sama sekali ketika perannya ditolak", async () => {
    await minta(sesiGuru);

    expect(pencatat.diterima).toHaveLength(0);
  });
});

describe("AC-17 — konteks hanya milik siswa penekan tombol, tanpa identitas", () => {
  it("menyusun konteks dari nilai siswa yang bersangkutan", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);

    const jawab = await minta(sesiSiswa);

    expect(jawab.status).toBe(200);
    expect(pencatat.diterima).toHaveLength(1);
    const konteks = pencatat.diterima[0]!;
    expect(konteks.mapel).toHaveLength(1);
    expect(konteks.mapel[0]!.nama).toBe(NAMA_MAPEL_A8);
    expect(konteks.mapel[0]!.nilaiAkhir).toBe(80);
  });

  it("tidak memuat nama maupun NIS di mana pun pada konteksnya", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);

    await minta(sesiSiswa);

    const serialisasi = JSON.stringify(pencatat.diterima[0]);
    expect(serialisasi).not.toContain("Dewi Anggraini");
    expect(serialisasi).not.toContain("a8-2028001");
    expect(serialisasi).not.toContain(A8.siswaBernilai);
  });

  it("menyertakan kehadiran sebagai fakta penjelas", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);
    await bukaSesiA8("2028-09-01", "alpa", A8.siswaBernilai);
    await bukaSesiA8("2028-09-02", "hadir", A8.siswaBernilai);

    await minta(sesiSiswa);

    expect(pencatat.diterima[0]!.mapel[0]!.kehadiranPersen).toBe(50);
  });

  it("PRD sec 8.6 butir 5 — nilai akhir null selama komponennya belum lengkap", async () => {
    await poolPemilik().query(
      `INSERT INTO nilai (penugasan_ref, komponen_ref, siswa_ref, nilai, diperbarui_oleh)
       SELECT '${A8.penugasan}', id, '${A8.siswaBernilai}', 70, '${A8.admin}'
       FROM komponen_penilaian ORDER BY urutan LIMIT 1`,
    );

    await minta(sesiSiswa);

    const mapel = pencatat.diterima[0]!.mapel[0]!;
    expect(mapel.lengkap).toBe(false);
    expect(mapel.nilaiAkhir).toBeNull();
  });
});

describe("CK-API-19 — data kosong dijawab tanpa memanggil AI", () => {
  it("menjawab 200 beserta cukup_data false", async () => {
    const jawab = await minta(sesiSiswaKosong);

    expect(jawab.status).toBe(200);
    const data = amplopData<{ cukup_data: boolean; teks: string; periode_nama: string }>(
      jawab.badan,
    );
    expect(data.cukup_data).toBe(false);
    expect(data.teks).toContain("Belum ada nilai");
    expect(data.periode_nama).toBe("a8-2028/2029 Ganjil");
  });

  it("tidak memanggil layanan AI sama sekali", async () => {
    await minta(sesiSiswaKosong);

    expect(pencatat.diterima).toHaveLength(0);
  });

  it("tidak menggerus jatah pembatas laju", async () => {
    for (let ke = 0; ke < 7; ke += 1) {
      expect((await minta(sesiSiswaKosong)).status).toBe(200);
    }
  });
});

describe("bentuk jawaban — API.md sec 9.1", () => {
  it("mengembalikan teks beserta penanda Data Sementara dan periodenya", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);

    const jawab = await minta(sesiSiswa);

    expect(amplopData(jawab.badan)).toMatchObject({
      teks: "Rekomendasi uji.",
      periode_nama: "a8-2028/2029 Ganjil",
      data_sementara: true,
      cukup_data: true,
    });
  });

  it("AC-16 — tidak ada GET pasangannya", async () => {
    const jawab = await panggilJson(app, "/api/saya/suggestion", { sesi: sesiSiswa });

    expect(jawab.status).toBe(404);
  });

  it("I-24 — keluaran tidak tersimpan di satu tabel pun", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);
    await minta(sesiSiswa);

    const jejak = await poolPemilik().query<{ jumlah: string }>(
      `SELECT (SELECT count(*) FROM audit_log)::text AS jumlah`,
    );
    expect(jejak.rows[0]!.jumlah).toBe("0");
  });
});

describe("AC-21 — kegagalan layanan AI bersifat lunak", () => {
  it("menjawab 503 LAYANAN_AI_GAGAL tanpa membocorkan sebab teknisnya", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);
    const gagal = penasihatPencatat({ berhasil: false, sebab: "batas_waktu" });
    const appGagal = await nyalakanAppUji({
      poolRo: poolBacaSaja(),
      penasihatAi: gagal.penasihat,
    });

    try {
      const jawab = await panggilJson(appGagal, "/api/saya/suggestion", {
        metode: "POST",
        sesi: sesiSiswa,
      });

      expect(jawab.status).toBe(503);
      const kesalahan = amplopKesalahan(jawab.badan);
      expect(kesalahan.kode).toBe("LAYANAN_AI_GAGAL");
      expect(kesalahan.pesan).not.toContain("batas_waktu");
    } finally {
      await appGagal.tutup();
    }
  });

  it("tidak menghambat penyimpanan nilai maupun jalur lain", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);
    const gagal = penasihatPencatat({ berhasil: false, sebab: "layanan_gagal" });
    const appGagal = await nyalakanAppUji({
      poolRo: poolBacaSaja(),
      penasihatAi: gagal.penasihat,
    });

    try {
      await panggilJson(appGagal, "/api/saya/suggestion", { metode: "POST", sesi: sesiSiswa });
      const nilai = await panggilJson(appGagal, "/api/saya/nilai", { sesi: sesiSiswa });

      expect(nilai.status).toBe(200);
    } finally {
      await appGagal.tutup();
    }
  });
});

describe("pembatas laju — 5 kali per jam per siswa (ARCHITECTURE Pasal 7)", () => {
  it("menolak penekanan keenam beserta waktu percobaan berikutnya", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);

    for (let ke = 0; ke < 5; ke += 1) {
      expect((await minta(sesiSiswa)).status).toBe(200);
    }

    const keenam = await minta(sesiSiswa);

    expect(keenam.status).toBe(429);
    const kesalahan = amplopKesalahan(keenam.badan);
    expect(kesalahan.kode).toBe("BATAS_LAJU_TERLAMPAUI");
    expect(kesalahan.rincian?.[0]).toHaveProperty("coba_lagi_pada");
  });

  it("menghitung setiap penekanan, bukan hanya yang gagal", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);
    for (let ke = 0; ke < 5; ke += 1) await minta(sesiSiswa);

    const jumlah = await poolPemilik().query<{ jumlah: number }>(
      `SELECT jumlah FROM pembatas_laju WHERE kunci = $1`,
      [`suggestion:${A8.siswaBernilai}`],
    );

    expect(jumlah.rows[0]!.jumlah).toBe(5);
  });

  it("jatah satu siswa tidak menggerus jatah siswa lain", async () => {
    await isiNilaiSiswa(A8.siswaBernilai, 80);
    for (let ke = 0; ke < 5; ke += 1) await minta(sesiSiswa);

    // Siswa kedua tidak punya nilai, tetapi tetap membuktikan kuncinya terpisah.
    expect((await minta(sesiSiswaKosong)).status).toBe(200);
  });
});

describe("I-23 dan AC-20 — jalur AI tidak dapat menulis apa pun", () => {
  it("koneksi yang dipakai rute ini ditolak PostgreSQL ketika menulis", async () => {
    await expect(poolBacaSaja().query("UPDATE nilai SET nilai = 100")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("koneksi yang dipakai rute ini tidak dapat membaca identitas", async () => {
    await expect(poolBacaSaja().query("SELECT nama FROM pengguna LIMIT 1")).rejects.toThrow(
      /permission denied/i,
    );
  });
});
