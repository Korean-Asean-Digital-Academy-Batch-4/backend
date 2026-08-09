import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import * as skema from "./skema/index.js";

/** Executor Drizzle bertipe atas seluruh skema aplikasi. */
export type BasisData = NodePgDatabase<typeof skema>;

/** Mengikat satu pool PostgreSQL pada executor Drizzle yang bertipe. */
export function buatBasisData(pool: Pool): BasisData {
  return drizzle(pool, { schema: skema });
}
