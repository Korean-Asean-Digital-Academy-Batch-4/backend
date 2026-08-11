import { kataSandiArgon2id } from "../adapters/local/kata-sandi.js";
import { berkasAdministrasiLokal } from "../adapters/local/berkas-administrasi/index.js";
import { penyimpananBerkasLokal } from "../adapters/local/penyimpanan-berkas.js";
import { raporBerkasLokal } from "../adapters/local/rapor-berkas/index.js";
import { buatApp } from "../app.js";
import { bacaKonfigurasi } from "../config.js";
import { buatBasisData } from "../db/drizzle.js";
import { buatPool } from "../db/index.js";

// Satu-satunya entry point. Tidak ada entry terpisah untuk AWS, karena AWS
// menjalankan container yang sama dengan on-prem — ARCHITECTURE.md sec 5.1.
const konfigurasi = bacaKonfigurasi();
const pool = buatPool(konfigurasi);
const app = buatApp({
  pool,
  db: buatBasisData(pool),
  kataSandi: kataSandiArgon2id(),
  berkasAdministrasi: berkasAdministrasiLokal(),
  penyimpanan: penyimpananBerkasLokal(konfigurasi.BERKAS_AKAR),
  raporBerkas: raporBerkasLokal(),
  sekarang: () => new Date(),
});

const server = app.listen(konfigurasi.PORT, () => {
  console.log(`edutrack-api mendengarkan di port ${konfigurasi.PORT}`);
});

for (const sinyal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinyal, () => {
    server.close(() => void pool.end());
  });
}
