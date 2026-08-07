import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Uji penegakan basis data menuntut Docker dan berjalan lewat
    // `npm run test:db` — vitest.config.db.ts.
    exclude: ["tests/db/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Ambang dinyalakan pada tahap A3, ketika domain/ sudah ada.
      // Sasaran: 80% global, 100% cabang pada domain/ — AGENTS.md sec 4.1
    },
  },
});
