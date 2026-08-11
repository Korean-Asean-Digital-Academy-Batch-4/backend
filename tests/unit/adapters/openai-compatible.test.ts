import { describe, expect, it, vi } from "vitest";

import { penasihatOpenAiCompatible } from "../../../src/adapters/openai-compatible/index.js";
import {
  PROMPT_SISTEM,
  susunPesanPengguna,
} from "../../../src/adapters/openai-compatible/prompt.js";
import type { KonteksSaran } from "../../../src/ports/ai-advisor.js";

// Kontrak permintaannya ditetapkan payload.md, yang diverifikasi terhadap
// endpoint sungguhan. Seluruh pengujian di bawah memakai fetch tiruan — tidak
// ada satu pun yang menyentuh Elice, sehingga AC-16, 17, 19, 20, dan 21 terbukti
// tanpa kunci API. Yang menunggu model sungguhan hanya AC-18 dan AC-31.

const KONTEKS: KonteksSaran = {
  periodeNama: "2026/2027 Ganjil",
  mapel: [
    {
      nama: "Matematika Wajib",
      kkm: 75,
      lengkap: true,
      nilaiAkhir: 68.5,
      kehadiranPersen: 62.5,
      komponen: [
        { kode: "T1", nama: "Tugas 1", bobot: 6, nilai: 70, topik: "Persamaan linear" },
        { kode: "UTS", nama: "Ujian Tengah Semester", bobot: 26, nilai: 65, topik: null },
      ],
    },
    {
      nama: "Biologi",
      kkm: 78,
      lengkap: false,
      nilaiAkhir: null,
      kehadiranPersen: null,
      komponen: [{ kode: "T1", nama: "Tugas 1", bobot: 6, nilai: null, topik: null }],
    },
  ],
};

function jawabanSukses(teks: string, finish = "stop"): Response {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finish, message: { content: teks } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Fetch tiruan yang mencatat panggilannya, bertipe agar dapat diperiksa. */
function ambilTiruan(jawab: () => Promise<Response>) {
  return vi.fn((_alamat: string | URL | Request, _pilihan?: RequestInit) =>
    jawab(),
  ) as unknown as typeof fetch & {
    mock: { calls: [string, RequestInit][] };
  };
}

function buatPenasihat(ambil: typeof fetch, batasWaktuMs?: number) {
  return penasihatOpenAiCompatible({
    baseUrl: "https://mlapi.run/contoh/",
    model: "gemini-3.6-flash",
    kunciApi: "kunci-rahasia",
    ambil,
    batasWaktuMs,
  });
}

describe("prompt sistem — AC-18 dan AC-31", () => {
  it("mewajibkan ketiga unsur keluaran", () => {
    expect(PROMPT_SISTEM).toContain("Rekomendasi belajar");
    expect(PROMPT_SISTEM).toContain("Alasan rekomendasi");
    expect(PROMPT_SISTEM).toContain("dua pilihan tindakan");
  });

  it("melarang keempat hal pada PRD sec 8.6 butir 4 dan AC-18", () => {
    expect(PROMPT_SISTEM).toContain("kelulusan");
    expect(PROMPT_SISTEM).toContain("Membandingkan siswa ini dengan siswa lain");
    expect(PROMPT_SISTEM).toContain("diagnosis psikologis");
    expect(PROMPT_SISTEM).toContain("sanksi");
  });

  it("menetapkan Bahasa Indonesia", () => {
    expect(PROMPT_SISTEM).toContain("Bahasa Indonesia");
  });

  it("menetapkan satu bentuk sapaan, supaya keluarannya tidak berganti-ganti", () => {
    expect(PROMPT_SISTEM).toContain('Sapa pembaca dengan "kamu"');
  });
});

describe("susunPesanPengguna — ARCHITECTURE sec 10.1", () => {
  it("memuat angka yang diperlukan model", () => {
    const pesan = susunPesanPengguna(KONTEKS);

    expect(pesan).toContain("2026/2027 Ganjil");
    expect(pesan).toContain("Matematika Wajib");
    expect(pesan).toContain("KKM: 75");
    expect(pesan).toContain("68.50");
    expect(pesan).toContain("62.50%");
    expect(pesan).toContain("Persamaan linear");
  });

  it("PRD sec 8.6 butir 5 — tidak menyebut nilai akhir yang datanya belum lengkap", () => {
    const pesan = susunPesanPengguna(KONTEKS);

    expect(pesan).toContain("belum dapat dihitung karena komponennya belum lengkap");
    expect(pesan).toContain("belum diisi");
  });

  it("menyatakan ketiadaan sesi presensi, bukan nol persen", () => {
    expect(susunPesanPengguna(KONTEKS)).toContain("belum ada sesi presensi");
  });

  it("AC-17 — tidak memuat nama, NIS, maupun pengenal apa pun", () => {
    const pesan = susunPesanPengguna(KONTEKS);

    // Bentuk UUID dan angka NIS tidak boleh muncul sama sekali. Tipe konteksnya
    // memang tidak memiliki tempat bagi keduanya — ini penjaga kedua.
    expect(pesan).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(pesan).not.toMatch(/\b\d{7,}\b/);
  });
});

describe("penasihatOpenAiCompatible — payload.md", () => {
  it("menambahkan /v1/chat/completions pada base URL", async () => {
    const ambil = ambilTiruan(async () => jawabanSukses("Rekomendasi."));
    await buatPenasihat(ambil).sarankan(KONTEKS);

    expect(ambil.mock.calls[0]![0]).toBe("https://mlapi.run/contoh/v1/chat/completions");
  });

  it("mengirim model, max_tokens minimal 2000, dan reasoning_effort low", async () => {
    const ambil = ambilTiruan(async () => jawabanSukses("Rekomendasi."));
    await buatPenasihat(ambil).sarankan(KONTEKS);

    const badan = JSON.parse(ambil.mock.calls[0]![1].body as string);
    expect(badan.model).toBe("gemini-3.6-flash");
    expect(badan.max_tokens).toBeGreaterThanOrEqual(2000);
    expect(badan.reasoning_effort).toBe("low");
    expect(badan.messages[0].role).toBe("system");
    expect(badan.messages[1].role).toBe("user");
  });

  it("mengirim kunci sebagai bearer token", async () => {
    const ambil = ambilTiruan(async () => jawabanSukses("Rekomendasi."));
    await buatPenasihat(ambil).sarankan(KONTEKS);

    const kepala = ambil.mock.calls[0]![1].headers as Record<string, string>;
    expect(kepala.authorization).toBe("Bearer kunci-rahasia");
  });

  it("mengembalikan teks jawaban ketika berhasil", async () => {
    const ambil = ambilTiruan(async () => jawabanSukses("  Fokus pada persamaan linear.  "));

    const hasil = await buatPenasihat(ambil).sarankan(KONTEKS);

    expect(hasil).toEqual({ berhasil: true, teks: "Fokus pada persamaan linear." });
  });

  it("payload.md sec 5 — finish_reason length diperlakukan sebagai KEGAGALAN", async () => {
    const ambil = ambilTiruan(async () => jawabanSukses("Mer", "length"));

    const hasil = await buatPenasihat(ambil).sarankan(KONTEKS);

    expect(hasil).toEqual({ berhasil: false, sebab: "jawaban_terpotong" });
  });

  it("menangani bentuk galat gateway Elice", async () => {
    const ambil = ambilTiruan(
      async () =>
        new Response(JSON.stringify({ error: { message: "x", type: "invalid_request_error" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );

    const hasil = await buatPenasihat(ambil).sarankan(KONTEKS);

    expect(hasil).toEqual({ berhasil: false, sebab: "layanan_gagal" });
  });

  it("menangani bentuk galat Google yang terbungkus larik", async () => {
    const ambil = ambilTiruan(
      async () =>
        new Response(JSON.stringify([{ error: { code: 400, status: "INVALID_ARGUMENT" } }]), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );

    const hasil = await buatPenasihat(ambil).sarankan(KONTEKS);

    expect(hasil).toEqual({ berhasil: false, sebab: "layanan_gagal" });
  });

  it("menjawab gagal lunak ketika jaringan bermasalah — AC-21", async () => {
    const ambil = ambilTiruan(async () => {
      throw new TypeError("fetch failed");
    });

    const hasil = await buatPenasihat(ambil).sarankan(KONTEKS);

    expect(hasil).toEqual({ berhasil: false, sebab: "layanan_gagal" });
  });

  it("membedakan batas waktu dari kegagalan lain", async () => {
    const ambil = ambilTiruan(async () => {
      const galat = new Error("timed out");
      galat.name = "TimeoutError";
      throw galat;
    });

    const hasil = await buatPenasihat(ambil).sarankan(KONTEKS);

    expect(hasil).toEqual({ berhasil: false, sebab: "batas_waktu" });
  });

  it("menjawab gagal ketika jawaban kosong", async () => {
    const ambil = ambilTiruan(async () => jawabanSukses("   "));

    const hasil = await buatPenasihat(ambil).sarankan(KONTEKS);

    expect(hasil).toEqual({ berhasil: false, sebab: "layanan_gagal" });
  });

  it("membatalkan permintaan yang melampaui batas waktu", async () => {
    const ambil = ((_alamat: string | URL | Request, pilihan?: RequestInit) =>
      new Promise<Response>((_selesai, gagal) => {
        pilihan?.signal?.addEventListener("abort", () => {
          const galat = new Error("aborted");
          galat.name = "TimeoutError";
          gagal(galat);
        });
      })) as unknown as typeof fetch;

    const hasil = await buatPenasihat(ambil, 20).sarankan(KONTEKS);

    expect(hasil).toEqual({ berhasil: false, sebab: "batas_waktu" });
  });
});
