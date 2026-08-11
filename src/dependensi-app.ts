import type { Pool } from "pg";

import type { BasisData } from "./db/drizzle.js";
import type { BerkasAdministrasi } from "./ports/berkas-administrasi.js";
import type { KataSandi } from "./ports/kata-sandi.js";
import type { PenyimpananBerkas } from "./ports/penyimpanan-berkas.js";
import type { RaporBerkas } from "./ports/rapor-berkas.js";

export type DependensiApp = Readonly<{
  pool: Pool;
  db: BasisData;
  kataSandi: KataSandi;
  berkasAdministrasi: BerkasAdministrasi;
  penyimpanan: PenyimpananBerkas;
  raporBerkas: RaporBerkas;
  sekarang: () => Date;
}>;
