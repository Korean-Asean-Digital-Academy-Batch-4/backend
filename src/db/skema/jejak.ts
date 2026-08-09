import { sql } from "drizzle-orm";
import { check, index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { pengguna } from "./identitas.js";

// SCHEMA.md sec 4.6. Tabel ini dibangun tetapi TIDAK DITULIS sepanjang MVP
// (CK-A-06). Ia melayani penelusuran administratif, bukan fitur produk.

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    penggunaRef: uuid("pengguna_ref")
      .notNull()
      .references(() => pengguna.id, { onDelete: "restrict" }),
    judul: text("judul").notNull(),
    deskripsi: text("deskripsi"),
    aksi: text("aksi").notNull(),
    entitas: text("entitas").notNull(),
    entitasRef: uuid("entitas_ref"),
    sebelum: jsonb("sebelum"),
    sesudah: jsonb("sesudah"),
    severity: text("severity").notNull(),
    // inet, bukan text: alamat tidak sah ditolak, IPv4 dan IPv6 tertampung sama
    alamatIp: inet("alamat_ip"),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("ck_audit_severity", sql`${t.severity} IN ('success', 'warning', 'failed')`),
    index("idx_audit_log_waktu").on(sql`${t.dibuatPada} DESC`),
  ],
);
