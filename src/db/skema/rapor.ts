import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { pengguna, siswa } from "./identitas.js";
import { kelas } from "./periode.js";

// SCHEMA.md sec 4.5. Dua CHECK konsistensi status menutup celah yang tidak
// terlihat: rapor final tanpa pertanggungjawaban siapa dan kapan, dan waktu
// distribusi pada rapor yang belum didistribusikan.

export const rapor = pgTable(
  "rapor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siswaRef: uuid("siswa_ref")
      .notNull()
      .references(() => siswa.penggunaRef, { onDelete: "restrict" }),
    kelasRef: uuid("kelas_ref").notNull(),
    periodeRef: uuid("periode_ref").notNull(),
    // I-21 ditegakkan trg_rapor_status_maju pada migrasi 0008
    status: text("status").notNull().default("draft"),
    catatanWali: text("catatan_wali"),
    difinalisasiOleh: uuid("difinalisasi_oleh").references(() => pengguna.id, {
      onDelete: "restrict",
    }),
    difinalisasiPada: timestamp("difinalisasi_pada", { withTimezone: true }),
    didistribusikanPada: timestamp("didistribusikan_pada", { withTimezone: true }),
    kunciBerkas: text("kunci_berkas"),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fk_rapor_kelas",
      columns: [t.kelasRef, t.periodeRef],
      foreignColumns: [kelas.id, kelas.periodeRef],
    }).onDelete("restrict"),
    unique("uq_rapor_siswa_periode").on(t.siswaRef, t.periodeRef),
    check("ck_rapor_status", sql`${t.status} IN ('draft', 'finalized', 'distributed')`),
    check("ck_rapor_catatan", sql`${t.catatanWali} IS NULL OR length(${t.catatanWali}) <= 1000`),
    check(
      "ck_rapor_finalisasi",
      sql`(${t.status} = 'draft' AND ${t.difinalisasiPada} IS NULL AND ${t.difinalisasiOleh} IS NULL)
          OR (${t.status} <> 'draft' AND ${t.difinalisasiPada} IS NOT NULL AND ${t.difinalisasiOleh} IS NOT NULL)`,
    ),
    check(
      "ck_rapor_distribusi",
      sql`(${t.status} = 'distributed') = (${t.didistribusikanPada} IS NOT NULL)`,
    ),
    index("idx_rapor_kelas").on(t.kelasRef),
  ],
);

// Salinan beku pada saat finalisasi. Tidak pernah dikueri sebagai data, melainkan
// dibaca utuh saat render PDF — karena itu tanpa indeks GIN. Bentuknya divalidasi
// Zod di batas aplikasi (ARCHITECTURE.md Pasal 12).
export const raporMapel = pgTable(
  "rapor_mapel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raporRef: uuid("rapor_ref")
      .notNull()
      .references(() => rapor.id, { onDelete: "cascade" }),
    mapelNama: text("mapel_nama").notNull(),
    kkm: smallint("kkm").notNull(),
    nilaiAkhir: numeric("nilai_akhir", { precision: 5, scale: 2 }).notNull(),
    kehadiranPersen: numeric("kehadiran_persen", { precision: 5, scale: 2 }).notNull(),
    snapshotKomponen: jsonb("snapshot_komponen").notNull(),
  },
  (t) => [
    unique("uq_rapor_mapel").on(t.raporRef, t.mapelNama),
    check("ck_rapor_mapel_kkm", sql`${t.kkm} BETWEEN 0 AND 100`),
    check("ck_rapor_mapel_nilai", sql`${t.nilaiAkhir} BETWEEN 0 AND 100`),
    check("ck_rapor_mapel_hadir", sql`${t.kehadiranPersen} BETWEEN 0 AND 100`),
    check("ck_rapor_mapel_snapshot", sql`jsonb_typeof(${t.snapshotKomponen}) = 'array'`),
  ],
);
