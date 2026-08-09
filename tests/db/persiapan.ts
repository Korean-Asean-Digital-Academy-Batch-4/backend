import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import type { GlobalSetupContext } from "vitest/node";

import { DIREKTORI_MIGRASI, terapkanMigrasi } from "../../src/db/migrasi.js";
import { BENIH, pernyataanBenih } from "./benih.js";

// PostgreSQL 17 sungguhan, bukan tiruan. Pasal 4.2 AGENTS.md menuntut bukti
// berupa pernyataan SQL yang wajib gagal; tiruan tidak dapat membuktikan apa pun
// tentang penolakan PostgreSQL.
const CITRA = "postgres:17";

// Kata sandi lingkungan uji, sekali pakai dan seumur satu kontainer.
// Bukan rahasia: kontainernya mati bersama proses tesnya.
const KATA_SANDI_UJI = "uji";

let kontainer: StartedPostgreSqlContainer | undefined;

function urlUntuk(peran: string, dasar: StartedPostgreSqlContainer): string {
  return `postgres://${peran}:${KATA_SANDI_UJI}@${dasar.getHost()}:${dasar.getPort()}/${dasar.getDatabase()}`;
}

export default async function persiapan({ provide }: GlobalSetupContext) {
  kontainer = await new PostgreSqlContainer(CITRA)
    .withUsername("edutrack_owner")
    .withPassword(KATA_SANDI_UJI)
    .withDatabase("edutrack")
    .start();

  const pemilik = new Pool({ connectionString: kontainer.getConnectionUri(), max: 2 });

  try {
    const diterapkan = await terapkanMigrasi(pemilik, DIREKTORI_MIGRASI);
    if (diterapkan.length === 0) {
      throw new Error("Tidak ada satu pun migrasi yang diterapkan");
    }

    // Langkah di luar migrasi, persis seperti pada penerapan sungguhan.
    // Migrasi 0009 membuat kedua role tanpa kata sandi (CK-S-09, temuan S-06);
    // nilainya ditetapkan di sini supaya tes dapat menyambung sebagai keduanya.
    await pemilik.query(`ALTER ROLE app_rw PASSWORD '${KATA_SANDI_UJI}'`);
    await pemilik.query(`ALTER ROLE app_ro PASSWORD '${KATA_SANDI_UJI}'`);

    await pemilik.query(pernyataanBenih());
  } finally {
    await pemilik.end();
  }

  provide("urlPemilik", kontainer.getConnectionUri());
  provide("urlRw", urlUntuk("app_rw", kontainer));
  provide("urlRo", urlUntuk("app_ro", kontainer));
  provide("benih", BENIH);

  return async () => {
    await kontainer?.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    urlPemilik: string;
    urlRw: string;
    urlRo: string;
    benih: typeof BENIH;
  }
}
