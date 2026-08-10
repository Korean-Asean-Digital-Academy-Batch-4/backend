import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { DatabaseError } from "pg";

import type { DependensiApp } from "./dependensi-app.js";
import { KODE, kirimKesalahan } from "./routes/amplop.js";
import { rutaKomponen } from "./routes/administrasi/komponen.js";
import { rutaMapel } from "./routes/administrasi/mapel.js";
import { rutaPeriode } from "./routes/administrasi/periode.js";
import { rutaTemplat } from "./routes/administrasi/templat.js";
import { rutaPengguna } from "./routes/administrasi/pengguna.js";
import { rutaAuth } from "./routes/auth.js";
import { rutaHealthz } from "./routes/healthz.js";
import { rutaSaya } from "./routes/saya.js";

// Express biasa. Aplikasi tidak mengetahui keberadaan Lambda maupun AWS
// — ARCHITECTURE.md Pasal 6 dan sec 5.1.
export function buatApp(deps: DependensiApp): Express {
  const app = express();
  app.disable("x-powered-by");
  // Batas 2 MB mengikuti batas unggahan pada ARCHITECTURE.md Pasal 7.
  // Primitive JSON dibiarkan mencapai Zod pada setiap rute, agar `null`, string,
  // dan larik ditolak sebagai 400 kontrak HTTP alih-alih SyntaxError parser 500.
  app.use(express.json({ limit: "2mb", strict: false }));
  app.use(cookieParser());

  app.use(rutaHealthz(deps.pool));
  app.use(rutaAuth(deps.pool, deps.db, deps.kataSandi));
  app.use(rutaSaya(deps.pool, deps.kataSandi));
  app.use(rutaTemplat(deps));
  app.use(rutaPengguna(deps));
  app.use(rutaPeriode(deps));
  app.use(rutaMapel(deps));
  app.use(rutaKomponen(deps));

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
  const pg = temukanGalatBerkode(galat);
  if (pg) {
    return { sumber: "postgres", code: pg.code, constraint: pg.constraint, table: pg.table };
  }
  if (galat instanceof Error) {
    return { sumber: "aplikasi", name: namaGalatAman(galat.name) };
  }
  return { sumber: "tidak dikenal" };
}

const NAMA_GALAT_AMAN = Object.freeze([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "AggregateError",
]);

function namaGalatAman(nama: string): string {
  return NAMA_GALAT_AMAN.includes(nama) ? nama : "Error";
}

/** Drizzle membungkus galat `pg` di properti `cause`; jangan log query/params pembungkusnya. */
function temukanGalatBerkode(
  galat: unknown,
): Readonly<{ code?: string; constraint?: string; table?: string }> | undefined {
  let saatIni = galat;
  const sudahDilihat = new Set<unknown>();
  while (typeof saatIni === "object" && saatIni !== null && !sudahDilihat.has(saatIni)) {
    sudahDilihat.add(saatIni);
    if (saatIni instanceof DatabaseError) {
      return {
        code: saatIni.code,
        constraint: saatIni.constraint,
        table: saatIni.table,
      };
    }
    saatIni = "cause" in saatIni ? (saatIni as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}
