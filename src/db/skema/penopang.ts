import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { pengguna } from "./identitas.js";

// SCHEMA.md sec 4.7. Keduanya tidak menambah entitas pada model data: sesi_masuk
// adalah wujud fisik CK-A-04, pembatas_laju wujud fisik CK-A-03.

// Yang disimpan adalah SHA-256 atas token, bukan tokennya. Salinan basis data
// mana pun karenanya tidak memuat satu sesi pun yang dapat dipakai masuk (CK-S-06).
export const sesiMasuk = pgTable(
  "sesi_masuk",
  {
    tokenHash: text("token_hash").primaryKey(),
    penggunaRef: uuid("pengguna_ref")
      .notNull()
      .references(() => pengguna.id, { onDelete: "cascade" }),
    dibuatPada: timestamp("dibuat_pada", { withTimezone: true }).notNull().defaultNow(),
    kedaluwarsaPada: timestamp("kedaluwarsa_pada", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("ck_sesi_masuk_umur", sql`${t.kedaluwarsaPada} > ${t.dibuatPada}`),
    // Pencabutan sesi pada penggantian kata sandi bersandar pada indeks ini
    index("idx_sesi_masuk_pengguna").on(t.penggunaRef),
    index("idx_sesi_masuk_kedaluwarsa").on(t.kedaluwarsaPada),
  ],
);

// Dibersihkan sendiri tanpa pekerjaan latar: setiap penulisan penghitung
// menghapus jendela yang sudah lewat untuk kunci yang sama (CK-07).
export const pembatasLaju = pgTable(
  "pembatas_laju",
  {
    kunci: text("kunci").notNull(),
    jendelaMulai: timestamp("jendela_mulai", { withTimezone: true }).notNull(),
    jumlah: integer("jumlah").notNull().default(0),
  },
  (t) => [
    primaryKey({ name: "pk_pembatas_laju", columns: [t.kunci, t.jendelaMulai] }),
    check("ck_pembatas_laju_jumlah", sql`${t.jumlah} >= 0`),
  ],
);
