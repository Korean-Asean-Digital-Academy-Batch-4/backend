import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

import type { DependensiApp } from "./dependensi-app.js";
import { KODE, kirimKesalahan } from "./routes/amplop.js";
import { rutaTemplat } from "./routes/administrasi/templat.js";
import { rutaAuth } from "./routes/auth.js";
import { rutaHealthz } from "./routes/healthz.js";
import { rutaSaya } from "./routes/saya.js";

// Express biasa. Aplikasi tidak mengetahui keberadaan Lambda maupun AWS
// — ARCHITECTURE.md Pasal 6 dan sec 5.1.
export function buatApp(deps: DependensiApp): Express {
  const app = express();
  app.disable("x-powered-by");
  // Batas 2 MB mengikuti batas unggahan pada ARCHITECTURE.md Pasal 7.
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.use(rutaHealthz(deps.pool));
  app.use(rutaAuth(deps.pool, deps.kataSandi));
  app.use(rutaSaya(deps.pool, deps.kataSandi));
  app.use(rutaTemplat(deps));

  // Alamat yang tidak dikenal tetap menjawab dengan amplop API.md sec 2.2,
  // bukan halaman HTML bawaan Express. Frontend hanya mengurai satu bentuk.
  app.use((_req, res) => {
    kirimKesalahan(res, 404, KODE.tidakDitemukan, "Alamat yang diminta tidak tersedia.");
  });

  // API.md sec 10: 500 TIDAK PERNAH membocorkan pesan asli, jejak tumpukan,
  // maupun kueri SQL. Rinciannya masuk ke log server; pengguna menerima pesan
  // tetap. Log ditulis dalam Bahasa Inggris ringkas dan tanpa data pribadi.
  app.use((galat: unknown, _req: Request, res: Response, _berikutnya: NextFunction) => {
    console.error("unhandled request error", ringkasGalat(galat));
    if (res.headersSent) return;
    kirimKesalahan(
      res,
      500,
      KODE.kesalahanServer,
      "Terjadi kesalahan pada server. Silakan coba lagi.",
    );
  });

  return app;
}

/**
 * Ringkasan galat yang aman ditulis ke log.
 *
 * Pesan galat PostgreSQL **memuat nilai data yang menyebabkannya** — misalnya
 * `Key (lower(nama_pengguna))=(198001011002) already exists`. Nilai itu NIP dan
 * NIS, yaitu data guru dan siswa yang sebagian di bawah umur. Log berada di
 * CloudWatch dan dapat dibaca lebih banyak orang daripada basis data, sehingga
 * pesan mentahnya tidak boleh masuk ke sana. Yang dicatat hanya kode SQLSTATE
 * dan nama constraint: cukup untuk menelusuri, tanpa satu pun nilai data.
 */
function ringkasGalat(galat: unknown): Record<string, unknown> {
  if (typeof galat === "object" && galat !== null && "code" in galat) {
    const pg = galat as { code?: string; constraint?: string; table?: string };
    return { sumber: "postgres", code: pg.code, constraint: pg.constraint, table: pg.table };
  }
  if (galat instanceof Error) {
    return { sumber: "aplikasi", name: galat.name, stack: galat.stack };
  }
  return { sumber: "tidak dikenal" };
}
