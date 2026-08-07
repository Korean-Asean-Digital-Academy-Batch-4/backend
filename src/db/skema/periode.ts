import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { guru, siswa } from "./identitas.js";

// SCHEMA.md sec 4.2. Jenjang dibatasi X, XI, dan XII — MVP mencakup SMA saja
// (temuan S-04, ditutup 7 Agustus 2026).

export const tahunAjaran = pgTable(
  "tahun_ajaran",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nama: text("nama").notNull(),
    tglMulai: date("tgl_mulai").notNull(),
    tglSelesai: date("tgl_selesai").notNull(),
    aktif: boolean("aktif").notNull().default(false),
  },
  (t) => [
    unique("uq_tahun_ajaran_nama").on(t.nama),
    check("ck_tahun_ajaran_rentang", sql`${t.tglSelesai} > ${t.tglMulai}`),
  ],
);

export const periode = pgTable(
  "periode",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tahunAjaranRef: uuid("tahun_ajaran_ref")
      .notNull()
      .references(() => tahunAjaran.id, { onDelete: "restrict" }),
    semester: text("semester").notNull(),
    tglMulai: date("tgl_mulai").notNull(),
    tglSelesai: date("tgl_selesai").notNull(),
    aktif: boolean("aktif").notNull().default(false),
  },
  (t) => [
    unique("uq_periode_tahun_semester").on(t.tahunAjaranRef, t.semester),
    check("ck_periode_semester", sql`${t.semester} IN ('ganjil', 'genap')`),
    check("ck_periode_rentang", sql`${t.tglSelesai} > ${t.tglMulai}`),
    // I-03: satu tahun ajaran memiliki paling banyak satu semester aktif
    uniqueIndex("uq_periode_aktif_per_tahun")
      .on(t.tahunAjaranRef)
      .where(sql`${t.aktif}`),
  ],
);

export const kelas = pgTable(
  "kelas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodeRef: uuid("periode_ref")
      .notNull()
      .references(() => periode.id, { onDelete: "restrict" }),
    nama: text("nama").notNull(),
    tingkat: text("tingkat").notNull(),
    jurusan: text("jurusan"),
    waliKelasRef: uuid("wali_kelas_ref").references(() => guru.penggunaRef, {
      onDelete: "restrict",
    }),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_kelas_periode_nama").on(t.periodeRef, t.nama),
    unique("uq_kelas_id_tingkat").on(t.id, t.tingkat),
    unique("uq_kelas_id_periode").on(t.id, t.periodeRef),
    check("ck_kelas_tingkat", sql`${t.tingkat} IN ('X', 'XI', 'XII')`),
    check("ck_kelas_nama", sql`length(${t.nama}) BETWEEN 1 AND 32`),
    // Satu Guru menjadi wali paling banyak satu kelas per periode — terjawab
    // 7 Agustus 2026, aktor-role sec 12 butir 1
    uniqueIndex("uq_kelas_wali_per_periode")
      .on(t.periodeRef, t.waliKelasRef)
      .where(sql`${t.waliKelasRef} IS NOT NULL`),
  ],
);

export const kelasSiswa = pgTable(
  "kelas_siswa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kelasRef: uuid("kelas_ref").notNull(),
    siswaRef: uuid("siswa_ref")
      .notNull()
      .references(() => siswa.penggunaRef, { onDelete: "restrict" }),
    periodeRef: uuid("periode_ref").notNull(),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // I-08 bersama uq_kelas_siswa_periode: mengunci periode agar selalu sama
    // dengan periode kelasnya, sehingga kolom itu tidak dapat menyimpang
    foreignKey({
      name: "fk_kelas_siswa_kelas",
      columns: [t.kelasRef, t.periodeRef],
      foreignColumns: [kelas.id, kelas.periodeRef],
    }).onDelete("restrict"),
    unique("uq_kelas_siswa_periode").on(t.siswaRef, t.periodeRef),
    unique("uq_kelas_siswa_kelas").on(t.kelasRef, t.siswaRef),
    index("idx_kelas_siswa_kelas").on(t.kelasRef),
  ],
);
