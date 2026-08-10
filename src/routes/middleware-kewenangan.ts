import type { RequestHandler } from "express";

import { KODE, kirimKesalahan } from "./amplop.js";

/** Menolak semua penuntut selain Administrator (API.md §2.3 dan §10). */
export function wajibAdministrator(): RequestHandler {
  return (req, res, berikutnya) => {
    if (req.penuntut?.peran !== "administrator") {
      kirimKesalahan(
        res,
        403,
        KODE.kewenanganDitolak,
        "Anda tidak berwenang melakukan tindakan ini.",
      );
      return;
    }

    berikutnya();
  };
}
