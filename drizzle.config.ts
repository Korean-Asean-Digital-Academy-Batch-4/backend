import { defineConfig } from "drizzle-kit";

// Techstack.md sec 4.2. Dipakai untuk MEMBANGKITKAN dan MENINJAU SQL dari skema
// Drizzle; berkas migrasi yang sungguh dijalankan tetap yang di `migrations/`,
// karena hanya di sana header klasifikasi dan penamaan expand/contract dapat
// dinyatakan (DEPLOYMENT.md sec 6.5 lapis 0 dan 1).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/skema/index.ts",
  out: "./.drizzle-bangkit",
  casing: "snake_case",
});
