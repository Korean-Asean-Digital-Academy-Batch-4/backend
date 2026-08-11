import type { Pool } from "pg";

import type { BasisData } from "./db/drizzle.js";
import type { BerkasAdministrasi } from "./ports/berkas-administrasi.js";
import type { AiAdvisor } from "./ports/ai-advisor.js";
import type { KataSandi } from "./ports/kata-sandi.js";
import type { PenyimpananBerkas } from "./ports/penyimpanan-berkas.js";
import type { RaporBerkas } from "./ports/rapor-berkas.js";

export type DependensiApp = Readonly<{
  pool: Pool;
  /**
   * Koneksi `app_ro` — hanya jalur AI. Tanpa hak tulis, dan tanpa hak baca
   * atas `pengguna`, `guru`, maupun `siswa` (ARCHITECTURE.md Pasal 8, I-23).
   */
  poolRo: Pool;
  db: BasisData;
  kataSandi: KataSandi;
  penasihatAi: AiAdvisor;
  berkasAdministrasi: BerkasAdministrasi;
  penyimpanan: PenyimpananBerkas;
  raporBerkas: RaporBerkas;
  sekarang: () => Date;
}>;
