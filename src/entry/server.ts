import { Pool } from "pg";

import { kataSandiArgon2id } from "../adapters/local/kata-sandi.js";
import { berkasAdministrasiLokal } from "../adapters/local/berkas-administrasi/index.js";
import { raporBerkasLokal } from "../adapters/local/rapor-berkas/index.js";
import { penasihatOpenAiCompatible } from "../adapters/openai-compatible/index.js";
import { buatApp } from "../app.js";
import { rakitKonfigurasi } from "../config.js";
import { buatBasisData } from "../db/drizzle.js";
import { buatPool } from "../db/index.js";
import { pilihLingkungan } from "./lingkungan.js";

// Satu-satunya entry point. Tidak ada entry terpisah untuk AWS, karena AWS
// menjalankan container yang sama dengan on-prem — ARCHITECTURE.md sec 5.1.
// Yang berbeda antar lingkungan hanya adapter yang dipilih di bawah, dan
// pemilihannya ditentukan satu variabel — entry/lingkungan.ts.
const lingkungan = pilihLingkungan();

// Rahasia dibaca SEKALI di sini, bukan pada setiap request — Techstack.md sec 7
// butir 3. Di Lambda pembacaannya jatuh pada cold start, sehingga request
// berikutnya pada instance yang sama tidak memanggil Secrets Manager sama sekali.
const konfigurasi = await rakitKonfigurasi(process.env, lingkungan.rahasia);

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
  penyimpanan: lingkungan.penyimpanan,
  raporBerkas: raporBerkasLokal(),
  penasihatAi: penasihatOpenAiCompatible({
    baseUrl: konfigurasi.ELICE_BASE_URL,
    model: konfigurasi.ELICE_MODEL,
    kunciApi: konfigurasi.ELICE_API_KEY,
  }),
  sekarang: () => new Date(),
});

const server = app.listen(konfigurasi.PORT, () => {
  console.log(
    `edutrack-api mendengarkan di port ${konfigurasi.PORT} (lingkungan ${lingkungan.nama})`,
  );
});

for (const sinyal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinyal, () => {
    server.close(() => void Promise.all([pool.end(), poolRo.end()]));
  });
}
