import { z } from "zod";

import type { Rahasia } from "./ports/rahasia.js";

/**
 * Konfigurasi proses. Dua pembaca, bukan satu — dan pemisahannya menentukan.
 *
 * [ARCHITECTURE.md §8] menetapkan aplikasi menyambung dengan **dua role**:
 * `app_rw` untuk jalur tulis dan `app_ro` untuk jalur AI. Kredensial
 * `edutrack_owner` — satu-satunya yang boleh DDL — **tidak boleh berada dalam
 * jangkauan proses yang melayani request**, sehingga ia dibaca pembaca
 * tersendiri yang hanya dipakai perintah migrasi. Di AWS pemisahan yang sama
 * ditegakkan IAM ([DEPLOYMENT.md §9.5]): fungsi `api` tidak dapat mengambil
 * rahasia `owner` sekalipun kodenya mencoba.
 */

const dasar = {
  PORT: z.coerce.number().int().positive().default(8080),
  // Satu instance Lambda melayani satu request, sehingga bawaannya 1.
  // Di luar Lambda dinaikkan lewat variabel lingkungan — ARCHITECTURE.md Pasal 6.
  DB_POOL_MAX: z.coerce.number().int().positive().default(1),
};

export const skemaKonfigurasi = z.object({
  ...dasar,
  /** Koneksi `app_rw` — seluruh jalur tulis aplikasi. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  /** Koneksi `app_ro` — jalur AI, tanpa hak tulis dan tanpa hak baca identitas. */
  DATABASE_URL_RO: z.string().min(1, "DATABASE_URL_RO wajib diisi"),
  // Direktori penyimpanan berkas rapor bagi adapter lokal. Penerapan AWS
  // memakai bucket S3 lewat adapter tersendiri — ARCHITECTURE.md Pasal 11.
  BERKAS_AKAR: z.string().min(1).default("./data/berkas"),
  /**
   * Berhenti pada id endpoint; `/v1/chat/completions` ditambahkan adapter.
   *
   * Ditolak apabila masih memuat `{` atau `}`, yaitu ketika contoh pada
   * `.env.example` disalin tanpa id endpointnya diganti. Tanpa pemeriksaan ini
   * kekeliruannya baru terlihat sebagai `404 model_not_found` dari gateway —
   * pesan yang menyesatkan, karena yang salah alamatnya, bukan nama modelnya
   * ([payload.md §1]).
   */
  ELICE_BASE_URL: z
    .string()
    .min(1, "ELICE_BASE_URL wajib diisi")
    .url("ELICE_BASE_URL wajib berupa URL yang sah")
    .refine((nilai) => !/[{}]/.test(nilai), {
      message:
        "ELICE_BASE_URL masih memuat contoh {endpoint-id}. Ganti dengan id endpoint yang sesungguhnya.",
    }),
  ELICE_MODEL: z.string().min(1, "ELICE_MODEL wajib diisi"),
  /** RAHASIA — Techstack.md §7. Di AWS dibaca dari SSM Parameter Store. */
  ELICE_API_KEY: z.string().min(1, "ELICE_API_KEY wajib diisi"),
});

export const skemaKonfigurasiMigrasi = z.object({
  ...dasar,
  /** Koneksi `edutrack_owner`. Hanya perintah migrasi yang membacanya. */
  DATABASE_URL_MIGRASI: z.string().min(1, "DATABASE_URL_MIGRASI wajib diisi"),
});

export type Konfigurasi = z.infer<typeof skemaKonfigurasi>;
export type KonfigurasiMigrasi = z.infer<typeof skemaKonfigurasiMigrasi>;

export function bacaKonfigurasi(env: NodeJS.ProcessEnv = process.env): Konfigurasi {
  return skemaKonfigurasi.parse(env);
}

export function bacaKonfigurasiMigrasi(env: NodeJS.ProcessEnv = process.env): KonfigurasiMigrasi {
  return skemaKonfigurasiMigrasi.parse(env);
}

/**
 * Menyusun konfigurasi dari lingkungan **beserta** rahasia yang dibaca port.
 *
 * Ketiga nilai rahasia diambil dari `Rahasia`, bukan dari `env` — sekalipun
 * variabel bernama sama kebetulan ada di sana. Pada lingkungan lokal keduanya
 * memang bermuara pada tempat yang sama, tetapi jalurnya tetap satu:
 * [ARCHITECTURE.md §12.1] menetapkan pembacaan rahasia melewati port, dan
 * pengecualian "kecuali di lokal" adalah cara tercepat kedua jalur menyimpang.
 *
 * Dipanggil **sekali pada saat container menyala** ([Techstack.md §7] butir 3).
 */
export async function rakitKonfigurasi(
  env: NodeJS.ProcessEnv,
  rahasia: Rahasia,
): Promise<Konfigurasi> {
  const [urlRw, urlRo, kunciAi] = await Promise.all([
    rahasia.urlBasisData("app_rw"),
    rahasia.urlBasisData("app_ro"),
    rahasia.kunciApiAi(),
  ]);

  return skemaKonfigurasi.parse({
    ...env,
    DATABASE_URL: urlRw,
    DATABASE_URL_RO: urlRo,
    ELICE_API_KEY: kunciAi,
  });
}

/** Setara di atas bagi perintah migrasi. Hanya peran `owner` yang diminta. */
export async function rakitKonfigurasiMigrasi(
  env: NodeJS.ProcessEnv,
  rahasia: Rahasia,
): Promise<KonfigurasiMigrasi> {
  return skemaKonfigurasiMigrasi.parse({
    ...env,
    DATABASE_URL_MIGRASI: await rahasia.urlBasisData("owner"),
  });
}
