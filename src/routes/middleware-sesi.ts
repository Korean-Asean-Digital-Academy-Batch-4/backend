import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool } from "pg";

import { cariSesiSah } from "../db/sesi.js";
import { bungkus } from "./bungkus.js";
import { KODE, kirimKesalahan } from "./amplop.js";

/**
 * Middleware sesi — ARCHITECTURE.md §9.1 dan §9.2.
 *
 * Peran dibaca dari basis data pada **setiap** request, bukan dititipkan pada
 * token. Pencabutan sesi dan penonaktifan akun karenanya berlaku seketika pada
 * request berikutnya (CK-A-04).
 */

/** API.md §2.5. */
export const NAMA_COOKIE_SESI = "edutrack_sesi";

export type Penuntut = {
  readonly penggunaRef: string;
  readonly peran: string;
  readonly token: string;
};

declare module "express-serve-static-core" {
  interface Request {
    penuntut?: Penuntut;
  }
}

/**
 * Menuntut sesi yang sah. Kegagalannya `401`, bukan `403`: yang belum
 * terpenuhi adalah autentikasinya, bukan kewenangannya (API.md §2.3).
 */
export function wajibMasuk(pool: Pool): RequestHandler {
  return bungkus(async (req: Request, res: Response, berikutnya: NextFunction) => {
    const token: unknown = req.cookies?.[NAMA_COOKIE_SESI];

    if (typeof token !== "string" || token.length === 0) {
      kirimKesalahan(res, 401, KODE.sesiTidakSah, "Sesi tidak ditemukan. Silakan masuk kembali.");
      return;
    }

    const sesi = await cariSesiSah(pool, token, new Date());
    if (!sesi) {
      kirimKesalahan(
        res,
        401,
        KODE.sesiTidakSah,
        "Sesi sudah berakhir atau dicabut. Silakan masuk kembali.",
      );
      return;
    }

    req.penuntut = { penggunaRef: sesi.penggunaRef, peran: sesi.peran, token };
    berikutnya();
  });
}
