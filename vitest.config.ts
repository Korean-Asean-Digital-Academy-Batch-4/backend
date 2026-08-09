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
      thresholds: {
        // AGENTS.md sec 4.1 — domain/ 100% cabang. Salah hitung di sana berarti
        // rapor siswa salah, dan tidak ada penjaga lain yang menangkapnya.
        // Keempat metrik dipatok 100, bukan cabangnya saja: fungsi domain yang
        // tidak pernah dipanggil sama sekali juga tidak terbukti benar.
        "src/domain/**/*.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Ambang global 80% BELUM dinyalakan. Angkanya baru bermakna setelah
        // lapisan rute ada (A5), dan pengukurannya menuntut penggabungan dua
        // suite: `npm test` dan `npm run test:db` berjalan pada konfigurasi
        // terpisah karena yang kedua menuntut Docker. Menyalakannya sekarang
        // berarti memasang ambang yang hanya dapat dipenuhi dengan mengecualikan
        // separuh src/ — ambang yang tidak menjaga apa pun.
      },
    },
  },
});
