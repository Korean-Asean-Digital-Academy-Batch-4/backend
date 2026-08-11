import { Pool } from "pg";

import { bacaKonfigurasiMigrasi } from "../config.js";
import { DIREKTORI_MIGRASI, terapkanMigrasi } from "../db/migrasi.js";

/**
 * Menerapkan migrasi yang belum pernah dijalankan.
 *
 *     npm run db:migrate
 *
 * Menyambung memakai `DATABASE_URL_MIGRASI`, yaitu kredensial `edutrack_owner`
 * — satu-satunya role yang boleh DDL. Kredensial itu **tidak pernah dibaca
 * proses yang melayani request**: `bacaKonfigurasi()` tidak mengenalnya sama
 * sekali ([ARCHITECTURE.md §8], [DEPLOYMENT.md §9.5]).
 *
 * Pemanggilan berulang tanpa migrasi baru tidak melakukan apa pun, sehingga
 * perintah ini aman dijalankan pada setiap rilis ([DEPLOYMENT.md §3.3]).
 */

const konfigurasi = bacaKonfigurasiMigrasi();
// Dua koneksi, bukan satu: penerapan memegang satu sebagai penjaga advisory
// lock dan menjalankan migrasinya lewat yang lain. `DB_POOL_MAX` sengaja tidak
// dipakai di sini — bawaannya 1, dan itu membuat penerapan menggantung.
const pool = new Pool({ connectionString: konfigurasi.DATABASE_URL_MIGRASI, max: 2 });

try {
  const diterapkan = await terapkanMigrasi(pool, DIREKTORI_MIGRASI);

  if (diterapkan.length === 0) {
    console.log("Tidak ada migrasi baru. Skema sudah mutakhir.");
  } else {
    console.log(`${diterapkan.length} migrasi diterapkan:`);
    for (const nama of diterapkan) console.log(`  ${nama}`);
  }
} catch (galat) {
  console.error(`Migrasi gagal: ${galat instanceof Error ? galat.message : String(galat)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
