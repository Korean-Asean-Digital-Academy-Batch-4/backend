import { buatApp } from "../app.js";
import { bacaKonfigurasi } from "../config.js";
import { buatPool } from "../db/index.js";

// Satu-satunya entry point. Tidak ada entry terpisah untuk AWS, karena AWS
// menjalankan container yang sama dengan on-prem — ARCHITECTURE.md sec 5.1.
const konfigurasi = bacaKonfigurasi();
const pool = buatPool(konfigurasi);
const app = buatApp({ pool });

const server = app.listen(konfigurasi.PORT, () => {
  console.log(`edutrack-api mendengarkan di port ${konfigurasi.PORT}`);
});

for (const sinyal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinyal, () => {
    server.close(() => void pool.end());
  });
}
