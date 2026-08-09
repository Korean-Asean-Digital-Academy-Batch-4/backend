import { defineConfig } from "vitest/config";

// Testcontainers biasanya menyalakan kontainer pengawas `ryuk` yang membereskan
// sisa kontainer bila prosesnya mati mendadak. Ia dimatikan di sini karena
// pembersihannya sudah dilakukan sendiri pada teardown tests/db/persiapan.ts, dan
// karena menyalakannya menuntut penarikan image tambahan — mesin pengembang tanpa
// akses registri jadi tidak dapat menjalankan gerbang A2 sama sekali.
process.env["TESTCONTAINERS_RYUK_DISABLED"] ??= "true";

// Uji penegakan basis data — tingkat ketiga pada AGENTS.md sec 4.2. Terpisah dari
// `npm test` karena menuntut Docker; `npm run periksa` karenanya tetap berjalan
// pada mesin tanpa Docker, sedangkan gerbang A2 memakai `npm run test:db`.
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/persiapan.ts"],

    // Satu kontainer dipakai bersama, dan sebagian tes menyentuh keadaan global
    // seperti indeks unik parsial dan catatan penerapan. Dijalankan berurutan
    // supaya kegagalan berarti pelanggaran invarian, bukan perlombaan.
    fileParallelism: false,

    // Menyalakan kontainer PostgreSQL dan menerapkan sepuluh migrasi.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json"],
    },
  },
});
