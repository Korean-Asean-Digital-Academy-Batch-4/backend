import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { guru } from "./identitas.js";
import { kelas } from "./periode.js";

// SCHEMA.md sec 4.3. Tiga composite foreign key pada penugasan adalah inti skema
// fisik: jenjang yang tidak cocok (I-06, AC-24) dan guru yang bukan pengampu
// (I-07) menjadi mustahil tersimpan, tanpa bergantung pada satu baris kode pun.

export const mapel = pgTable(
  "mapel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kode: text("kode").notNull(),
    nama: text("nama").notNull(),
    tingkat: text("tingkat").notNull(),
    // I-11 dan AC-22: KKM bernilai awal 75 dan dapat diubah Administrator
    kkm: smallint("kkm").notNull().default(75),
    guruRef: uuid("guru_ref")
      .notNull()
      .references(() => guru.penggunaRef, { onDelete: "restrict" }),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
    diperbaruiPada: timestamp("diperbarui_pada", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("uq_mapel_kode").on(t.kode),
    unique("uq_mapel_guru").on(t.guruRef),
    unique("uq_mapel_id_tingkat").on(t.id, t.tingkat),
    unique("uq_mapel_id_guru").on(t.id, t.guruRef),
    check("ck_mapel_tingkat", sql`${t.tingkat} IN ('X', 'XI', 'XII')`),
    check("ck_mapel_kkm", sql`${t.kkm} BETWEEN 0 AND 100`),
    check("ck_mapel_nama", sql`length(${t.nama}) BETWEEN 1 AND 64`),
  ],
);

export const penugasan = pgTable(
  "penugasan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guruRef: uuid("guru_ref").notNull(),
    mapelRef: uuid("mapel_ref").notNull(),
    kelasRef: uuid("kelas_ref").notNull(),
    tingkat: text("tingkat").notNull(),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Satu kolom `tingkat` menjadi bagian dari kedua foreign key, sehingga kedua
    // sisi wajib menunjuk jenjang yang sama
    foreignKey({
      name: "fk_penugasan_mapel_tingkat",
      columns: [t.mapelRef, t.tingkat],
      foreignColumns: [mapel.id, mapel.tingkat],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_penugasan_kelas_tingkat",
      columns: [t.kelasRef, t.tingkat],
      foreignColumns: [kelas.id, kelas.tingkat],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_penugasan_mapel_guru",
      columns: [t.mapelRef, t.guruRef],
      foreignColumns: [mapel.id, mapel.guruRef],
    }).onDelete("restrict"),
    unique("uq_penugasan_kelas_mapel").on(t.kelasRef, t.mapelRef),
    index("idx_penugasan_guru").on(t.guruRef),
    index("idx_penugasan_kelas").on(t.kelasRef),
  ],
);

export const komponenPenilaian = pgTable(
  "komponen_penilaian",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kode: text("kode").notNull(),
    nama: text("nama").notNull(),
    bobot: smallint("bobot").notNull(),
    urutan: smallint("urutan").notNull(),
  },
  (t) => [
    unique("uq_komponen_kode").on(t.kode),
    unique("uq_komponen_urutan").on(t.urutan),
    check("ck_komponen_bobot", sql`${t.bobot} > 0 AND ${t.bobot} <= 100`),
  ],
);

export const penugasanKomponen = pgTable(
  "penugasan_komponen",
  {
    penugasanRef: uuid("penugasan_ref")
      .notNull()
      .references(() => penugasan.id, { onDelete: "restrict" }),
    komponenRef: uuid("komponen_ref")
      .notNull()
      .references(() => komponenPenilaian.id, { onDelete: "restrict" }),
    topik: text("topik"),
  },
  (t) => [
    primaryKey({ name: "pk_penugasan_komponen", columns: [t.penugasanRef, t.komponenRef] }),
    check("ck_penugasan_komponen_topik", sql`${t.topik} IS NULL OR length(${t.topik}) <= 200`),
  ],
);
