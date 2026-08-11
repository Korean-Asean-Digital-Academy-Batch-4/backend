import { Pool, type PoolClient } from "pg";
import { expect, inject } from "vitest";

let pemilik: Pool | undefined;
let bacaSaja: Pool | undefined;

export function poolPemilik(): Pool {
  pemilik ??= new Pool({ connectionString: inject("urlPemilik"), max: 4 });
  return pemilik;
}

/**
 * Pool `app_ro` — role jalur AI.
 *
 * Dipakai pengujian yang harus membuktikan penegakan basis datanya sendiri:
 * menyambung sebagai pemilik lalu berpura-pura membaca terbatas tidak
 * membuktikan apa pun (I-23, AC-20).
 */
export function poolBacaSaja(): Pool {
  bacaSaja ??= new Pool({ connectionString: inject("urlRo"), max: 2 });
  return bacaSaja;
}

export async function tutupPool(): Promise<void> {
  await pemilik?.end();
  await bacaSaja?.end();
  pemilik = undefined;
  bacaSaja = undefined;
}

/**
 * Menjalankan `jalan` di dalam transaksi yang **selalu** dibatalkan.
 *
 * Setiap tes penegakan karenanya berangkat dari benih yang sama, dan urutan
 * berjalannya tes tidak dapat mengubah hasil tes lain.
 */
export async function dalamTransaksiBatal<T>(jalan: (klien: PoolClient) => Promise<T>): Promise<T> {
  const klien = await poolPemilik().connect();
  try {
    await klien.query("BEGIN");
    return await jalan(klien);
  } finally {
    await klien.query("ROLLBACK").catch(() => undefined);
    klien.release();
  }
}

export type Penolakan = { pesan: string; kode: string | undefined; constraint: string | undefined };

/**
 * Menyatakan bahwa `jalan` ditolak PostgreSQL, dan mengembalikan penolakannya
 * untuk diperiksa lebih lanjut.
 *
 * Inilah bentuk pembuktian pada AGENTS.md sec 4.2: yang diuji bukan bahwa jalur
 * hari ini tidak melanggar, melainkan bahwa jalur mana pun tidak akan bisa.
 */
export async function harusDitolak(jalan: () => Promise<unknown>): Promise<Penolakan> {
  try {
    await jalan();
  } catch (galat) {
    const g = galat as { message?: string; code?: string; constraint?: string };
    return {
      pesan: g.message ?? String(galat),
      kode: g.code,
      constraint: g.constraint,
    };
  }

  expect.fail("Pernyataan ini seharusnya ditolak basis data, tetapi berhasil");
}
