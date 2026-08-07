import { z } from "zod";

export const skemaKonfigurasi = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  // Satu instance Lambda melayani satu request, sehingga bawaannya 1.
  // Di luar Lambda dinaikkan lewat variabel lingkungan — ARCHITECTURE.md Pasal 6.
  DB_POOL_MAX: z.coerce.number().int().positive().default(1),
});

export type Konfigurasi = z.infer<typeof skemaKonfigurasi>;

export function bacaKonfigurasi(env: NodeJS.ProcessEnv = process.env): Konfigurasi {
  return skemaKonfigurasi.parse(env);
}
