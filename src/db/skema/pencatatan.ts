import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { pengguna, siswa } from "./identitas.js";
import { komponenPenilaian, penugasan } from "./kurikulum.js";

// SCHEMA.md sec 4.4. nilai.nilai bersifat NOT NULL, dan inilah penegakan I-12:
// baris nilai hanya ada apabila nilainya terisi, sehingga "belum lengkap"
// memiliki satu representasi tunggal — ketiadaan baris.

export const nilai = pgTable(
  "nilai",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    penugasanRef: uuid("penugasan_ref")
      .notNull()
      .references(() => penugasan.id, { onDelete: "restrict" }),
    komponenRef: uuid("komponen_ref")
      .notNull()
      .references(() => komponenPenilaian.id, { onDelete: "restrict" }),
    siswaRef: uuid("siswa_ref")
      .notNull()
      .references(() => siswa.penggunaRef, { onDelete: "restrict" }),
    // CK-S-08: numeric, bukan pecahan biner. Angka ini tercetak pada rapor.
    nilai: numeric("nilai", { precision: 5, scale: 2 }).notNull(),
    diperbaruiOleh: uuid("diperbarui_oleh")
      .notNull()
      .references(() => pengguna.id, { onDelete: "restrict" }),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
    diperbaruiPada: timestamp("diperbarui_pada", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("uq_nilai").on(t.penugasanRef, t.komponenRef, t.siswaRef),
    check("ck_nilai_rentang", sql`${t.nilai} >= 0 AND ${t.nilai} <= 100`),
    index("idx_nilai_penugasan_siswa").on(t.penugasanRef, t.siswaRef),
    index("idx_nilai_siswa").on(t.siswaRef),
  ],
);

export const sesi = pgTable(
  "sesi",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    penugasanRef: uuid("penugasan_ref")
      .notNull()
      .references(() => penugasan.id, { onDelete: "restrict" }),
    // Sesi melekat pada tanggal kalender sekolah, bukan pada momen berzona waktu
    tanggal: date("tanggal").notNull(),
    dibukaOleh: uuid("dibuka_oleh")
      .notNull()
      .references(() => pengguna.id, { onDelete: "restrict" }),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uq_sesi_penugasan_tanggal").on(t.penugasanRef, t.tanggal)],
);

export const presensi = pgTable(
  "presensi",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Satu-satunya CASCADE pada data akademik — I-16, AC-25
    sesiRef: uuid("sesi_ref")
      .notNull()
      .references(() => sesi.id, { onDelete: "cascade" }),
    siswaRef: uuid("siswa_ref")
      .notNull()
      .references(() => siswa.penggunaRef, { onDelete: "restrict" }),
    // P6 dan AC-11: sesi selalu terbuka dengan seluruh siswa berstatus Alpa
    status: text("status").notNull().default("alpa"),
    catatan: text("catatan"),
    diperbaruiOleh: uuid("diperbarui_oleh")
      .notNull()
      .references(() => pengguna.id, { onDelete: "restrict" }),
    diperbaruiPada: timestamp("diperbarui_pada", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("uq_presensi").on(t.sesiRef, t.siswaRef),
    check("ck_presensi_status", sql`${t.status} IN ('hadir', 'izin', 'sakit', 'alpa')`),
    check("ck_presensi_catatan", sql`${t.catatan} IS NULL OR length(${t.catatan}) <= 200`),
    index("idx_presensi_siswa").on(t.siswaRef),
  ],
);
