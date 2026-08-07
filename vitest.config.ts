import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Ambang dinyalakan pada tahap A3, ketika domain/ sudah ada.
      // Sasaran: 80% global, 100% cabang pada domain/ — AGENTS.md sec 4.1
    },
  },
});
