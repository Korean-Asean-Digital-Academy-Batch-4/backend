import {
  BATAS_WAKTU_AI_MS,
  type AiAdvisor,
  type HasilSaran,
  type KonteksSaran,
} from "../../ports/ai-advisor.js";
import { PROMPT_SISTEM, susunPesanPengguna } from "./prompt.js";

/**
 * Klien OpenAI-compatible — [Techstack.md §6] dan [payload.md].
 *
 * Dinamai menurut protokol, bukan penyedia (CK-A-02). Seluruh ketentuan di
 * bawah berasal dari [payload.md], yang diverifikasi langsung terhadap endpoint
 * — bukan dari dokumentasi vendor.
 */

/**
 * Anggaran token **minimal 2000**, bahkan untuk jawaban satu paragraf.
 *
 * Model penalaran menghitung token penalarannya terhadap anggaran yang sama
 * dengan token jawaban. Anggaran 100 menghasilkan jawaban terpenggal menjadi
 * tiga huruf, dan 300 memotongnya di tengah kalimat ([payload.md §5]).
 */
const MAX_TOKENS = 2000;

/** Menekan penalaran menjadi ~220 token. `"none"` diterima tetapi diabaikan. */
const REASONING_EFFORT = "low";

/** Rendah supaya rekomendasi tidak berayun jauh antar penekanan tombol. */
const TEMPERATURE = 0.3;

export type PilihanPenasihat = Readonly<{
  /** Berhenti pada id endpoint; `/v1/chat/completions` ditambahkan di sini. */
  baseUrl: string;
  model: string;
  kunciApi: string;
  batasWaktuMs?: number;
  /** Disuntikkan pada pengujian. Bawaannya `fetch` global. */
  ambil?: typeof fetch;
}>;

type Jawaban = Readonly<{
  choices?: readonly {
    finish_reason?: string;
    message?: { content?: string };
  }[];
}>;

export function penasihatOpenAiCompatible(pilihan: PilihanPenasihat): AiAdvisor {
  const ambil = pilihan.ambil ?? fetch;
  const batasWaktuMs = pilihan.batasWaktuMs ?? BATAS_WAKTU_AI_MS;
  const alamat = `${pilihan.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  return {
    async sarankan(konteks: KonteksSaran): Promise<HasilSaran> {
      const pembatal = AbortSignal.timeout(batasWaktuMs);

      let jawaban: Response;
      try {
        jawaban = await ambil(alamat, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${pilihan.kunciApi}`,
          },
          body: JSON.stringify({
            model: pilihan.model,
            messages: [
              { role: "system", content: PROMPT_SISTEM },
              { role: "user", content: susunPesanPengguna(konteks) },
            ],
            max_tokens: MAX_TOKENS,
            temperature: TEMPERATURE,
            reasoning_effort: REASONING_EFFORT,
          }),
          signal: pembatal,
        });
      } catch (galat) {
        // Batas waktu dan kegagalan jaringan dibedakan karena yang pertama
        // wajar terjadi pada model penalaran, sedangkan yang kedua menandakan
        // sesuatu yang lain. Keduanya tetap kegagalan lunak (AC-21).
        return {
          berhasil: false,
          sebab: namaGalat(galat) === "TimeoutError" ? "batas_waktu" : "layanan_gagal",
        };
      }

      if (!jawaban.ok) {
        // Dua bentuk galat sekaligus — [payload.md §7]. Isinya tidak dibaca:
        // pesan penyedia tidak pernah sampai ke siswa, dan tidak ada satu pun
        // bagiannya yang aman diteruskan apa adanya.
        console.error("ai request failed", { status: jawaban.status });
        return { berhasil: false, sebab: "layanan_gagal" };
      }

      const isi = (await jawaban.json().catch(() => undefined)) as Jawaban | undefined;
      const pilihanPertama = isi?.choices?.[0];
      const teks = pilihanPertama?.message?.content?.trim();

      // `length` berarti anggaran token habis sebelum kalimatnya selesai.
      // Jawaban terpotong TIDAK boleh sampai ke siswa sebagai rekomendasi
      // ([payload.md §5]) — ia kegagalan, bukan jawaban yang lebih pendek.
      if (pilihanPertama?.finish_reason === "length") {
        console.error("ai answer truncated", { max_tokens: MAX_TOKENS });
        return { berhasil: false, sebab: "jawaban_terpotong" };
      }

      if (!teks) {
        console.error("ai answer empty");
        return { berhasil: false, sebab: "layanan_gagal" };
      }

      return { berhasil: true, teks };
    },
  };
}

function namaGalat(galat: unknown): string {
  return galat instanceof Error ? galat.name : "Error";
}
