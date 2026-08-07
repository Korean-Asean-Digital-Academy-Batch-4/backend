import { describe, expect, it } from "vitest";
import { bacaKonfigurasi } from "../../src/config.js";

describe("bacaKonfigurasi", () => {
  it("memakai nilai bawaan ketika hanya DATABASE_URL diberikan", () => {
    const k = bacaKonfigurasi({ DATABASE_URL: "postgres://x" });

    expect(k.PORT).toBe(8080);
    // Bawaan 1 mengikuti disiplin pool Lambda — ARCHITECTURE.md Pasal 6.
    expect(k.DB_POOL_MAX).toBe(1);
  });

  it("menolak konfigurasi tanpa DATABASE_URL", () => {
    expect(() => bacaKonfigurasi({})).toThrow();
  });

  it("membaca DB_POOL_MAX dari lingkungan untuk pemakaian di luar Lambda", () => {
    const k = bacaKonfigurasi({ DATABASE_URL: "postgres://x", DB_POOL_MAX: "10" });

    expect(k.DB_POOL_MAX).toBe(10);
  });
});
