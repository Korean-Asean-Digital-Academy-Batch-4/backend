import express, { type Express } from "express";
import type { Pool } from "pg";
import { rutaHealthz } from "./routes/healthz.js";

// Express biasa. Aplikasi tidak mengetahui keberadaan Lambda maupun AWS
// — ARCHITECTURE.md Pasal 6 dan sec 5.1.
export function buatApp(deps: { pool: Pool }): Express {
  const app = express();
  app.disable("x-powered-by");
  // Batas 2 MB mengikuti batas unggahan pada ARCHITECTURE.md Pasal 7.
  app.use(express.json({ limit: "2mb" }));
  app.use(rutaHealthz(deps.pool));
  return app;
}
