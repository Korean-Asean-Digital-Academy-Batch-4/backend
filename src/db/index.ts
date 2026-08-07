import { Pool } from "pg";
import type { Konfigurasi } from "../config.js";

export function buatPool(konfigurasi: Konfigurasi): Pool {
  return new Pool({
    connectionString: konfigurasi.DATABASE_URL,
    max: konfigurasi.DB_POOL_MAX,
  });
}

export type HasilPeriksaKoneksi = { siap: true } | { siap: false; sebab: string };

export async function periksaKoneksi(pool: Pool): Promise<HasilPeriksaKoneksi> {
  try {
    await pool.query("SELECT 1");
    return { siap: true };
  } catch (galat) {
    return { siap: false, sebab: galat instanceof Error ? galat.message : String(galat) };
  }
}
