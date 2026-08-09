import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";

import * as skema from "../../src/db/skema/index.js";
import { poolPemilik, tutupPool } from "./bantuan.js";

// Berkas migrasi dan skema Drizzle diturunkan dari SCHEMA.md masing-masing, bukan
// satu dari yang lain. Keduanya karenanya dapat menyimpang tanpa ada yang menegur
// — sampai kueri tahap A5 mengembalikan kolom yang tidak ada. Berkas ini yang
// menegur, dan yang menang selalu migrasinya karena itulah yang sungguh berjalan.

function tabelDrizzle(): PgTable[] {
  // Lewat `unknown` supaya predikatnya dibandingkan terhadap satu tipe, bukan
  // terhadap gabungan sembilan belas tipe tabel yang masing-masing khas.
  const semua: unknown[] = Object.values(skema);
  return semua.filter((nilai): nilai is PgTable => is(nilai, PgTable));
}

type KolomBasisData = { table_name: string; column_name: string; tipe: string; wajib: boolean };

async function kolomBasisData(): Promise<Map<string, KolomBasisData>> {
  const hasil = await poolPemilik().query<KolomBasisData>(`
    SELECT c.relname                              AS table_name,
           a.attname                              AS column_name,
           format_type(a.atttypid, a.atttypmod)   AS tipe,
           a.attnotnull                           AS wajib
    FROM pg_attribute a
    JOIN pg_class     c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`);

  return new Map(hasil.rows.map((baris) => [`${baris.table_name}.${baris.column_name}`, baris]));
}

// Drizzle menulis "numeric(5, 2)", PostgreSQL "numeric(5,2)". Perbedaan spasi
// bukan perbedaan skema.
function samakan(tipe: string): string {
  return tipe.replaceAll(" ", "").toLowerCase();
}

afterAll(tutupPool);

describe("skema Drizzle selaras dengan hasil migrasi", () => {
  it("menyebut sembilan belas tabel yang sama", async () => {
    const dariDrizzle = tabelDrizzle()
      .map((tabel) => getTableConfig(tabel).name)
      .sort();
    const hasil = await poolPemilik().query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    expect(dariDrizzle).toEqual(hasil.rows.map((baris) => baris.tablename));
  });

  it("setiap kolom Drizzle ada di basis data dengan tipe dan kewajiban yang sama", async () => {
    const basisData = await kolomBasisData();
    const selisih: string[] = [];

    for (const tabel of tabelDrizzle()) {
      const konfigurasi = getTableConfig(tabel);

      for (const kolom of konfigurasi.columns) {
        const kunci = `${konfigurasi.name}.${kolom.name}`;
        const nyata = basisData.get(kunci);

        if (!nyata) {
          selisih.push(`${kunci} ada di Drizzle tetapi tidak di basis data`);
          continue;
        }
        if (samakan(kolom.getSQLType()) !== samakan(nyata.tipe)) {
          selisih.push(
            `${kunci} bertipe ${kolom.getSQLType()} di Drizzle, ${nyata.tipe} di basis data`,
          );
        }
        if (kolom.notNull !== nyata.wajib) {
          selisih.push(
            `${kunci} NOT NULL berbeda: Drizzle ${kolom.notNull}, basis data ${nyata.wajib}`,
          );
        }
      }
    }

    expect(selisih).toEqual([]);
  });

  it("tidak meninggalkan kolom basis data yang tak dikenal Drizzle", async () => {
    const basisData = await kolomBasisData();
    const dariDrizzle = new Set(
      tabelDrizzle().flatMap((tabel) => {
        const konfigurasi = getTableConfig(tabel);
        return konfigurasi.columns.map((kolom) => `${konfigurasi.name}.${kolom.name}`);
      }),
    );

    expect([...basisData.keys()].filter((kunci) => !dariDrizzle.has(kunci)).sort()).toEqual([]);
  });
});
