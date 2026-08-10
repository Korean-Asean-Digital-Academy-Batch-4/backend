import type { Pool } from "pg";

import type { BasisData } from "./db/drizzle.js";
import type { BerkasAdministrasi } from "./ports/berkas-administrasi.js";
import type { KataSandi } from "./ports/kata-sandi.js";

export type DependensiApp = Readonly<{
  pool: Pool;
  db: BasisData;
  kataSandi: KataSandi;
  berkasAdministrasi: BerkasAdministrasi;
  sekarang: () => Date;
}>;
