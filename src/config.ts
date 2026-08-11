import { z } from "zod";

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
