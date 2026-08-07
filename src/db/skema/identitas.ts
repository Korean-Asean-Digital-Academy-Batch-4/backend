import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// SCHEMA.md sec 4.1. Kolom `peran` pada guru dan siswa tidak menyimpan informasi
// baru; ia menjadi bagian kedua composite foreign key ke pengguna (id, peran).

export const pengguna = pgTable(
  "pengguna",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    namaPengguna: text("nama_pengguna").notNull(),
    nama: text("nama").notNull(),
    peran: text("peran").notNull(),
    kataSandiHash: text("kata_sandi_hash").notNull(),
    aktif: boolean("aktif").notNull().default(true),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
    diperbaruiPada: timestamp("diperbarui_pada", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("uq_pengguna_id_peran").on(t.id, t.peran),
    check("ck_pengguna_peran", sql`${t.peran} IN ('administrator', 'guru', 'siswa')`),
    check("ck_pengguna_nama_pengguna", sql`length(${t.namaPengguna}) BETWEEN 1 AND 32`),
    check("ck_pengguna_nama", sql`length(${t.nama}) BETWEEN 1 AND 128`),
    // I-02: unik lintas seluruh pengguna, tidak peka huruf besar-kecil
    uniqueIndex("uq_pengguna_nama_pengguna").on(sql`lower(${t.namaPengguna})`),
  ],
);

export const guru = pgTable(
  "guru",
  {
    penggunaRef: uuid("pengguna_ref").primaryKey(),
    peran: text("peran").notNull().default("guru"),
  },
  (t) => [
    check("ck_guru_peran", sql`${t.peran} = 'guru'`),
    foreignKey({
      name: "fk_guru_pengguna",
      columns: [t.penggunaRef, t.peran],
      foreignColumns: [pengguna.id, pengguna.peran],
    }).onDelete("restrict"),
  ],
);

export const siswa = pgTable(
  "siswa",
  {
    penggunaRef: uuid("pengguna_ref").primaryKey(),
    peran: text("peran").notNull().default("siswa"),
  },
  (t) => [
    check("ck_siswa_peran", sql`${t.peran} = 'siswa'`),
    foreignKey({
      name: "fk_siswa_pengguna",
      columns: [t.penggunaRef, t.peran],
      foreignColumns: [pengguna.id, pengguna.peran],
    }).onDelete("restrict"),
  ],
);
