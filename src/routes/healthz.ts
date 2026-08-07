import { Router } from "express";
import type { Pool } from "pg";
import { periksaKoneksi } from "../db/index.js";

// Dipakai Lambda Web Adapter sebagai readiness check: trafik tidak masuk
// sebelum pool basis data siap — ARCHITECTURE.md Pasal 6.
export function rutaHealthz(pool: Pool): Router {
  const ruta = Router();

  ruta.get("/healthz", (_req, res) => {
    void (async () => {
      const basisData = await periksaKoneksi(pool);
      if (basisData.siap) {
        res.status(200).json({ data: { proses: "siap", basis_data: "siap" } });
        return;
      }
      res.status(503).json({
        kesalahan: {
          kode: "BASIS_DATA_TIDAK_SIAP",
          pesan: "Basis data tidak dapat dihubungi.",
          rincian: [{ sebab: basisData.sebab }],
        },
      });
    })();
  });

  return ruta;
}
