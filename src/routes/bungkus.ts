import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Membungkus handler asinkron supaya penolakan promise sampai ke penangan galat.
 *
 * Tanpa ini, pola `void (async () => { … })()` menelan penolakannya: kegagalan
 * basis data menjadi unhandled rejection di tingkat proses, dan permintaannya
 * menggantung sampai batas waktu alih-alih dijawab `500`. Tidak ada galat yang
 * boleh ditelan diam-diam.
 */
export function bungkus(
  handler: (req: Request, res: Response, berikutnya: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, berikutnya) => {
    handler(req, res, berikutnya).catch(berikutnya);
  };
}
