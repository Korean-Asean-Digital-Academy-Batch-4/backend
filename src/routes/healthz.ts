import { Router } from "express";
import type { Pool } from "pg";
import { periksaKoneksi } from "../db/index.js";
import { bungkus } from "./bungkus.js";

// Dipakai Lambda Web Adapter sebagai readiness check: trafik tidak masuk
// sebelum pool basis data siap — ARCHITECTURE.md Pasal 6.
//
// DUA alamat, satu penangan, dan keduanya diperlukan.
//
// `/healthz` dipanggil adapter dari dalam container, tanpa melewati CloudFront.
// `/api/healthz` dipanggil pipeline sesudah alias dipindahkan (DEPLOYMENT.md
// sec 3.3 langkah 11) — dan hanya `/api/*` yang diteruskan CloudFront ke Lambda
// (ARCHITECTURE.md Pasal 3). Tanpa alamat kedua, pemeriksaan rilis dilayani
// bucket frontend dan selalu lulus tanpa memeriksa apa pun.
export function rutaHealthz(pool: Pool): Router {
  const ruta = Router();

  ruta.get(
    ["/healthz", "/api/healthz"],
    bungkus(async (_req, res) => {
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
    }),
  );

  return ruta;
}
