import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { buatBasisData } from "../../../src/db/drizzle.js";

const poolTiruan = {} as Pool;

describe("buatBasisData", () => {
  it("membuat executor Drizzle bertipe dari satu pool", () => {
    const db = buatBasisData(poolTiruan);

    expect(db.select).toBeTypeOf("function");
    expect(db.transaction).toBeTypeOf("function");
  });
});
