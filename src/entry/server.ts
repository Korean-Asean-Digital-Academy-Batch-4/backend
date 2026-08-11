import { Pool } from "pg";

import { kataSandiArgon2id } from "../adapters/local/kata-sandi.js";
import { berkasAdministrasiLokal } from "../adapters/local/berkas-administrasi/index.js";
import { raporBerkasLokal } from "../adapters/local/rapor-berkas/index.js";
import { penasihatOpenAiCompatible } from "../adapters/openai-compatible/index.js";
import { buatApp } from "../app.js";
import { rakitKonfigurasi, rakitKonfigurasiMigrasi } from "../config.js";
import { buatBasisData } from "../db/drizzle.js";
import { buatPool } from "../db/index.js";
import { DIREKTORI_MIGRASI, terapkanMigrasi } from "../db/migrasi.js";
import { buatLayananMigrasi } from "./layanan-migrasi.js";
import { pilihLingkungan, pilihLingkunganMigrasi } from "./lingkungan.js";
import { bacaPeran } from "./peran.js";

// Satu-satunya entry point. Tidak ada entry terpisah untuk AWS, karena AWS
// menjalankan container yang sama dengan on-prem — ARCHITECTURE.md sec 5.1.
//
// DUA hal dipilih di sini, dan keduanya satu variabel lingkungan:
//
//   LINGKUNGAN  lokal | aws     dari mana rahasia dibaca (Pasal 13)
//   PERAN       api   | migrasi apa yang dilayani proses ini (CK-D-08)
//
// Kedua fungsi Lambda menjalankan image dan perintah yang sama persis; yang
// membedakan keduanya hanya baris kedua.
const peran = bacaPeran();

if (peran === "migrasi") {
  await jalankanLayananMigrasi();
} else {
  await jalankanAplikasi();
}

async function jalankanLayananMigrasi(): Promise<void> {
  const konfigurasi = await rakitKonfigurasiMigrasi(process.env, pilihLingkunganMigrasi().rahasia);

  // Dua koneksi, bukan satu: penerapan memegang satu sebagai penjaga advisory
  // lock dan menjalankan migrasinya lewat yang lain. `DB_POOL_MAX` sengaja
  // tidak dipakai di sini — bawaannya 1, dan itu membuat penerapan menggantung.
  const pool = new Pool({ connectionString: konfigurasi.DATABASE_URL_MIGRASI, max: 2 });

  const server = buatLayananMigrasi({
    terapkan: () => terapkanMigrasi(pool, DIREKTORI_MIGRASI),
  });

  server.listen(konfigurasi.PORT, () => {
    console.log(`edutrack-migrate mendengarkan di port ${konfigurasi.PORT}`);
  });

  for (const sinyal of ["SIGTERM", "SIGINT"] as const) {
    process.on(sinyal, () => {
      server.close(() => void pool.end());
    });
  }
}

async function jalankanAplikasi(): Promise<void> {
  const lingkungan = pilihLingkungan();

  // Rahasia dibaca SEKALI di sini, bukan pada setiap request — Techstack.md
  // sec 7 butir 3. Di Lambda pembacaannya jatuh pada cold start, sehingga
  // request berikutnya pada instance yang sama tidak memanggil Secrets Manager
  // sama sekali.
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
}
