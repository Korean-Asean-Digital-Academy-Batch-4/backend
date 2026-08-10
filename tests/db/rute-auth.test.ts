import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";

import { kataSandiArgon2id } from "../../src/adapters/local/kata-sandi.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import type { AppUji } from "./bantuan-rute.js";
import { nyalakanAppUji } from "./bantuan-rute.js";

// API.md sec 3 dan sec 10, ARCHITECTURE.md sec 9.1 dan Pasal 7.
// AC-33: tidak ada endpoint lupa kata sandi dalam bentuk apa pun.

const b = inject("benih");
const KATA_SANDI = "kata-sandi-uji";

let app: AppUji;
let hashBenih: string;

async function panggil(
  jalan: string,
  pilihan: { metode?: string; badan?: unknown; cookie?: string; ip?: string } = {},
): Promise<{
  status: number;
  // Badan respons HTTP bersifat dinamis; bentuknya ditegaskan lewat assertion
  // pada tiap tes, bukan lewat tipe. Menuliskan tipenya di sini akan menyalin
  // kontrak API.md ke tempat kedua yang dapat menyimpang.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  badan: any;
  setCookie: string | null;
}> {
  const jawab = await fetch(`${app.asal}${jalan}`, {
    method: pilihan.metode ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(pilihan.cookie ? { cookie: pilihan.cookie } : {}),
      ...(pilihan.ip ? { "x-forwarded-for": pilihan.ip } : {}),
    },
    ...(pilihan.badan === undefined || (pilihan.metode ?? "GET") === "GET"
      ? {}
      : { body: JSON.stringify(pilihan.badan) }),
  });

  const teks = await jawab.text();
  return {
    status: jawab.status,
    badan: teks ? JSON.parse(teks) : null,
    setCookie: jawab.headers.get("set-cookie"),
  };
}

async function masuk(namaPengguna = "198001011001", kataSandi = KATA_SANDI, ip?: string) {
  return panggil("/api/auth/masuk", {
    metode: "POST",
    badan: { nama_pengguna: namaPengguna, kata_sandi: kataSandi },
    ...(ip ? { ip } : {}),
  });
}

function ambilToken(setCookie: string | null): string {
  const cocok = setCookie?.match(/edutrack_sesi=([^;]+)/);
  if (!cocok?.[1]) throw new Error(`Set-Cookie tidak memuat sesi: ${setCookie}`);
  return `edutrack_sesi=${cocok[1]}`;
}

beforeAll(async () => {
  hashBenih = await kataSandiArgon2id().hash(KATA_SANDI);

  app = await nyalakanAppUji();
});

afterAll(async () => {
  try {
    await app.tutup();
  } finally {
    try {
      // Memulihkan benih: berkas tes lain menyandarkan diri pada nilai 'x'.
      await poolPemilik().query(`UPDATE pengguna SET kata_sandi_hash = 'x'`);
    } finally {
      await tutupPool();
    }
  }
});

beforeEach(async () => {
  await poolPemilik().query(`DELETE FROM sesi_masuk`);
  await poolPemilik().query(`DELETE FROM pembatas_laju`);
  // Sebagian tes menonaktifkan akun atau mengganti kata sandinya; keadaan awal
  // dipulihkan di sini supaya urutan berjalannya tes tidak mengubah hasil.
  await poolPemilik().query(`UPDATE pengguna SET aktif = true, kata_sandi_hash = $1`, [hashBenih]);
});

describe("POST /api/auth/masuk", () => {
  it("menerima kredensial yang benar dan memasang cookie sesi", async () => {
    const jawab = await masuk();

    expect(jawab.status).toBe(200);
    expect(jawab.badan.data.id).toBe(b.guruBio);
    expect(jawab.badan.data.peran).toBe("guru");
    expect(jawab.badan.data.nama).toBe("Guru Biologi");
  });

  it("memasang cookie HttpOnly, Secure, SameSite=Strict, dan berumur 12 jam", async () => {
    const { setCookie } = await masuk();

    expect(setCookie).toContain("edutrack_sesi=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=43200");
  });

  it("tidak pernah mengembalikan hash kata sandi", async () => {
    const jawab = await masuk();

    expect(JSON.stringify(jawab.badan)).not.toContain("argon2");
    expect(jawab.badan.data.kata_sandi_hash).toBeUndefined();
  });

  it("menyertakan penugasan dan wali_kelas — UC-01 dan CK-A-01", async () => {
    const jawab = await masuk();

    expect(jawab.badan.data.penugasan).toEqual([
      { id: b.penugasanBioX1, kelas_nama: "X-1", mapel_nama: "Biologi" },
    ]);
    expect(jawab.badan.data.wali_kelas).toEqual([{ kelas_ref: b.kelasX1, kelas_nama: "X-1" }]);
  });

  it("mengembalikan wali_kelas kosong bagi Guru yang bukan wali", async () => {
    const jawab = await masuk("198001011002");

    expect(jawab.badan.data.wali_kelas).toEqual([]);
  });

  it("menolak kata sandi yang keliru dengan KREDENSIAL_SALAH", async () => {
    const jawab = await masuk("198001011001", "salah");

    expect(jawab.status).toBe(401);
    expect(jawab.badan.kesalahan.kode).toBe("KREDENSIAL_SALAH");
    expect(jawab.setCookie).toBeNull();
  });

  it("menolak akun yang tidak ada dengan kode yang SAMA — keberadaan akun tidak terungkap", async () => {
    const tidakAda = await masuk("tidak-pernah-ada", "apa pun");
    const salahSandi = await masuk("198001011001", "salah");

    expect(tidakAda.status).toBe(salahSandi.status);
    expect(tidakAda.badan.kesalahan.kode).toBe(salahSandi.badan.kesalahan.kode);
    expect(tidakAda.badan.kesalahan.pesan).toBe(salahSandi.badan.kesalahan.pesan);
  });

  it("menolak akun nonaktif dengan kode yang sama pula — API sec 3.1", async () => {
    await poolPemilik().query(`UPDATE pengguna SET aktif = false WHERE id = $1`, [b.guruBio]);

    const jawab = await masuk();

    expect(jawab.status).toBe(401);
    expect(jawab.badan.kesalahan.kode).toBe("KREDENSIAL_SALAH");
  });

  it("menolak badan yang bentuknya tidak sah", async () => {
    const jawab = await panggil("/api/auth/masuk", {
      metode: "POST",
      badan: { nama_pengguna: "x" },
    });

    expect(jawab.status).toBe(400);
    expect(jawab.badan.kesalahan.kode).toBe("PERMINTAAN_TIDAK_SAH");
  });

  it("menolak bidang yang tidak dikenal, bukan mengabaikannya — API sec 2.7", async () => {
    const jawab = await panggil("/api/auth/masuk", {
      metode: "POST",
      badan: { nama_pengguna: "198001011001", kata_sandi: KATA_SANDI, peran: "administrator" },
    });

    expect(jawab.status).toBe(400);
  });

  it("menerima kata sandi tanpa syarat kerumitan — PRD sec 6.1.3", async () => {
    const hash = await kataSandiArgon2id().hash("a");
    await poolPemilik().query(`UPDATE pengguna SET kata_sandi_hash = $1 WHERE id = $2`, [
      hash,
      b.siswaAndi,
    ]);

    const jawab = await masuk("2026001", "a");

    expect(jawab.status).toBe(200);
  });
});

describe("pembatas laju 5 percobaan gagal per 15 menit", () => {
  it("menolak percobaan keenam dengan 429 dan waktu coba lagi", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await masuk("198001011001", "salah")).status).toBe(401);
    }

    const keenam = await masuk("198001011001", "salah");

    expect(keenam.status).toBe(429);
    expect(keenam.badan.kesalahan.kode).toBe("BATAS_LAJU_TERLAMPAUI");
    expect(keenam.badan.kesalahan.rincian[0].coba_lagi_pada).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("menolak juga kredensial yang BENAR setelah batas terlampaui", async () => {
    for (let i = 0; i < 5; i += 1) await masuk("198001011001", "salah");

    expect((await masuk()).status).toBe(429);
  });

  it("tidak menggerus jatah ketika masuk berhasil", async () => {
    for (let i = 0; i < 4; i += 1) await masuk("198001011001", "salah");
    expect((await masuk()).status).toBe(200);

    for (let i = 0; i < 4; i += 1) {
      expect((await masuk("198001011001", "salah")).status).toBe(401);
    }
  });

  it("tidak menular ke akun lain", async () => {
    for (let i = 0; i < 5; i += 1) await masuk("198001011001", "salah");

    expect((await masuk("198001011002")).status).toBe(200);
  });
});

describe("GET /api/saya", () => {
  it("menolak tanpa cookie dengan SESI_TIDAK_SAH", async () => {
    const jawab = await panggil("/api/saya");

    expect(jawab.status).toBe(401);
    expect(jawab.badan.kesalahan.kode).toBe("SESI_TIDAK_SAH");
  });

  it("menolak cookie karangan", async () => {
    const jawab = await panggil("/api/saya", { cookie: "edutrack_sesi=karangan" });

    expect(jawab.status).toBe(401);
  });

  it("mengembalikan bentuk yang sama dengan respons masuk", async () => {
    const hasilMasuk = await masuk();
    const saya = await panggil("/api/saya", { cookie: ambilToken(hasilMasuk.setCookie) });

    expect(saya.status).toBe(200);
    expect(saya.badan.data).toEqual(hasilMasuk.badan.data);
  });
});

describe("POST /api/auth/keluar — pencabutan seketika", () => {
  it("menjawab 204 dan menghapus sesinya", async () => {
    const cookie = ambilToken((await masuk()).setCookie);

    const keluar = await panggil("/api/auth/keluar", { metode: "POST", cookie });

    expect(keluar.status).toBe(204);
    expect((await panggil("/api/saya", { cookie })).status).toBe(401);
  });

  it("menolak keluar tanpa sesi", async () => {
    expect((await panggil("/api/auth/keluar", { metode: "POST" })).status).toBe(401);
  });
});

describe("PATCH /api/saya/kata-sandi", () => {
  it("mengganti kata sandi dan mencabut sesi lain, tetapi mempertahankan yang dipakai", async () => {
    const lama = ambilToken((await masuk()).setCookie);
    const dipakai = ambilToken((await masuk()).setCookie);

    const ganti = await panggil("/api/saya/kata-sandi", {
      metode: "PATCH",
      cookie: dipakai,
      badan: { kata_sandi_lama: KATA_SANDI, kata_sandi_baru: "yang-baru" },
    });

    expect(ganti.status).toBe(204);
    expect((await panggil("/api/saya", { cookie: dipakai })).status).toBe(200);
    expect((await panggil("/api/saya", { cookie: lama })).status).toBe(401);
  });

  it("membuat kata sandi lama tidak lagi berlaku", async () => {
    const cookie = ambilToken((await masuk()).setCookie);
    await panggil("/api/saya/kata-sandi", {
      metode: "PATCH",
      cookie,
      badan: { kata_sandi_lama: KATA_SANDI, kata_sandi_baru: "yang-baru" },
    });

    expect((await masuk("198001011001", KATA_SANDI)).status).toBe(401);
    expect((await masuk("198001011001", "yang-baru")).status).toBe(200);
  });

  it("menolak ketika kata sandi lama keliru", async () => {
    const cookie = ambilToken((await masuk()).setCookie);

    const jawab = await panggil("/api/saya/kata-sandi", {
      metode: "PATCH",
      cookie,
      badan: { kata_sandi_lama: "keliru", kata_sandi_baru: "yang-baru" },
    });

    expect(jawab.status).toBe(401);
    expect(jawab.badan.kesalahan.kode).toBe("KREDENSIAL_SALAH");
  });

  it("menolak tanpa sesi", async () => {
    const jawab = await panggil("/api/saya/kata-sandi", {
      metode: "PATCH",
      badan: { kata_sandi_lama: KATA_SANDI, kata_sandi_baru: "yang-baru" },
    });

    expect(jawab.status).toBe(401);
  });
});

describe("AC-33 — tidak ada jalur pemulihan mandiri", () => {
  it.each([
    ["POST", "/api/auth/lupa-kata-sandi"],
    ["POST", "/api/auth/reset-kata-sandi"],
    ["POST", "/api/auth/lupa"],
    ["GET", "/api/auth/lupa-kata-sandi"],
  ])("tidak memiliki %s %s", async (metode, jalan) => {
    const jawab = await panggil(jalan, { metode, badan: { nama_pengguna: "198001011001" } });

    expect(jawab.status).toBe(404);
  });
});

describe("CK-A-08 — lapis kedua per alamat IP", () => {
  it("menahan penyemprotan lintas akun dari satu alamat", async () => {
    // Tiap akun hanya menyumbang satu kegagalan, sehingga batas per akun tidak
    // pernah tersentuh. Yang menahannya adalah lapis IP.
    for (let i = 0; i < 30; i += 1) {
      const jawab = await masuk(`tidak-ada-${i}`, "tebakan", "203.0.113.7");
      expect(jawab.status).toBe(401);
    }

    const berikutnya = await masuk("tidak-ada-30", "tebakan", "203.0.113.7");

    expect(berikutnya.status).toBe(429);
    expect(berikutnya.badan.kesalahan.kode).toBe("BATAS_LAJU_TERLAMPAUI");
  });

  it("tidak menahan alamat lain", async () => {
    for (let i = 0; i < 30; i += 1) await masuk(`tidak-ada-${i}`, "tebakan", "203.0.113.7");

    expect((await masuk("198001011001", KATA_SANDI, "198.51.100.9")).status).toBe(200);
  });

  it("tidak dapat dilewati dengan memalsukan entri X-Forwarded-For di depan", async () => {
    for (let i = 0; i < 30; i += 1) await masuk(`tidak-ada-${i}`, "tebakan", "203.0.113.7");

    // Klien menyisipkan alamat karangan di depan; proksi tetap menambahkan
    // alamat sesungguhnya di ujung, dan entri itulah yang dipakai.
    const jawab = await masuk("tidak-ada-99", "tebakan", "9.9.9.9, 203.0.113.7");

    expect(jawab.status).toBe(429);
  });
});

describe("M-1 — pembatas laju pada penggantian kata sandi", () => {
  it("menolak sesudah lima kali kata sandi lama keliru", async () => {
    const cookie = ambilToken((await masuk()).setCookie);

    for (let i = 0; i < 5; i += 1) {
      const jawab = await panggil("/api/saya/kata-sandi", {
        metode: "PATCH",
        cookie,
        badan: { kata_sandi_lama: "keliru", kata_sandi_baru: "baru" },
      });
      expect(jawab.status).toBe(401);
    }

    const keenam = await panggil("/api/saya/kata-sandi", {
      metode: "PATCH",
      cookie,
      badan: { kata_sandi_lama: "keliru", kata_sandi_baru: "baru" },
    });

    expect(keenam.status).toBe(429);
  });
});
