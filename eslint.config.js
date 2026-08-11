import js from "@eslint/js";
import tseslint from "typescript-eslint";

const pesan = "Melanggar batas modul ARCHITECTURE.md sec 5.1";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Penangan galat Express dikenali dari jumlah argumennya — empat, tepat.
  // Argumen keempat yang tidak terpakai karenanya syarat kerangka kerja, bukan
  // kelalaian. Awalan garis bawah menyatakan ketidakterpakaiannya disengaja.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  // SDK AWS hanya boleh diimpor adapters/aws/ — larangan mutlak 6 pada
  // AGENTS.md sec 3.2, Prinsip 3 pada Techstack.md sec 1.
  //
  // Ditegakkan menyeluruh, bukan per lapisan. Aturan per lapisan menutup
  // domain/ dan routes/ tetapi meninggalkan entry/, db/, dan ports/ terbuka —
  // dan entry/ justru yang paling mudah tergoda, karena ia memang menyusun
  // adapter dan tampak wajar menyerahkan klien yang sudah jadi.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/adapters/aws/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@aws-sdk/*", "@smithy/*"],
              message: `SDK AWS hanya boleh diimpor adapters/aws/. ${pesan}`,
            },
          ],
        },
      ],
    },
  },

  // domain/ tanpa I/O sama sekali. Salah hitung di sini berarti rapor siswa salah,
  // sehingga ia harus dapat diuji tanpa basis data dan tanpa AWS.
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "express",
                "pg",
                "drizzle-orm",
                "drizzle-orm/*",
                "@aws-sdk/*",
                "**/db/**",
                "**/adapters/**",
                "**/routes/**",
              ],
              message: `domain/ tidak boleh melakukan I/O. ${pesan}`,
            },
          ],
        },
      ],
    },
  },

  // routes/ tidak boleh mengenal AWS secara langsung.
  {
    files: ["src/routes/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/adapters/aws/**", "@aws-sdk/*"],
              message: `routes/ hanya lewat ports/. ${pesan}`,
            },
          ],
        },
      ],
    },
  },

  // adapters/ tidak boleh menarik domain maupun routes ke dalamnya.
  {
    files: ["src/adapters/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/domain/**", "**/routes/**"],
              message: `adapters/ hanya bergantung pada ports/. ${pesan}`,
            },
          ],
        },
      ],
    },
  },
);
