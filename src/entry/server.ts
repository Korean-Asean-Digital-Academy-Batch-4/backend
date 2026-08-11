import { kataSandiArgon2id } from "../adapters/local/kata-sandi.js";
import { berkasAdministrasiLokal } from "../adapters/local/berkas-administrasi/index.js";
import { penyimpananBerkasLokal } from "../adapters/local/penyimpanan-berkas.js";
import { raporBerkasLokal } from "../adapters/local/rapor-berkas/index.js";
import { penasihatOpenAiCompatible } from "../adapters/openai-compatible/index.js";
import { buatApp } from "../app.js";
import { bacaKonfigurasi } from "../config.js";
import { buatBasisData } from "../db/drizzle.js";
import { Pool } from "pg";

import { buatPool } from "../db/index.js";

// Satu-satunya entry point. Tidak ada entry terpisah untuk AWS, karena AWS
// menjalankan container yang sama dengan on-prem — ARCHITECTURE.md sec 5.1.
const konfigurasi = bacaKonfigurasi();
const pool = buatPool(konfigurasi);
// Pool kedua, bukan koneksi kedua pada pool yang sama: rolenya berbeda, dan
// perbedaan itulah yang menegakkan I-23 — ARCHITECTURE.md Pasal 8.
const poolRo = new Pool({
  connectionString: konfigurasi.DATABASE_URL_RO,
  max: konfigurasi.DB_POOL_MAX,
});
const app = buatApp({
  pool,
  poolRo,
  db: buatBasisData(pool),
  kataSandi: kataSandiArgon2id(),
  berkasAdministrasi: berkasAdministrasiLokal(),
  penyimpanan: penyimpananBerkasLokal(konfigurasi.BERKAS_AKAR),
  raporBerkas: raporBerkasLokal(),
  penasihatAi: penasihatOpenAiCompatible({
    baseUrl: konfigurasi.ELICE_BASE_URL,
    model: konfigurasi.ELICE_MODEL,
    kunciApi: konfigurasi.ELICE_API_KEY,
  }),
  sekarang: () => new Date(),
});

const server = app.listen(konfigurasi.PORT, () => {
  console.log(`edutrack-api mendengarkan di port ${konfigurasi.PORT}`);
});

for (const sinyal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinyal, () => {
    server.close(() => void Promise.all([pool.end(), poolRo.end()]));
  });
}
