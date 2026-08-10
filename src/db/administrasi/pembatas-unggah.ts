import { and, eq, lt, sql } from "drizzle-orm";

import { awalJendela, cobaLagiPada } from "../../domain/pembatas-laju.js";
import { pembatasLaju } from "../skema/penopang.js";
import type { BasisData } from "../drizzle.js";

export const BATAS_UNGGAH_PER_JAM = 10;
export const JENDELA_UNGGAH_MS = 60 * 60 * 1000;

export type HasilJatahUnggah =
  Readonly<{ boleh: true }> | Readonly<{ boleh: false; cobaLagiPada: Date }>;

/**
 * Mengambil satu jatah unggah secara atomik pada PostgreSQL bersama.
 *
 * `WHERE jumlah < 10` berada di lengan konflik UPSERT, sehingga percobaan
 * serentak tidak dapat sama-sama lolos setelah penghitung mencapai sepuluh.
 * Percobaan yang ditolak tidak menambah penghitung melewati batas.
 */
export async function pakaiJatahUnggah(
  db: BasisData,
  penggunaRef: string,
  sekarang: Date,
): Promise<HasilJatahUnggah> {
  const kunci = `unggah:${penggunaRef}`;
  const mulai = awalJendela(sekarang, JENDELA_UNGGAH_MS);
  await db.delete(pembatasLaju).where(lt(pembatasLaju.jendelaMulai, mulai));
  const terpakai = await db
    .insert(pembatasLaju)
    .values({ kunci, jendelaMulai: mulai, jumlah: 1 })
    .onConflictDoUpdate({
      target: [pembatasLaju.kunci, pembatasLaju.jendelaMulai],
      set: { jumlah: sql`${pembatasLaju.jumlah} + 1` },
      setWhere: and(
        eq(pembatasLaju.kunci, kunci),
        eq(pembatasLaju.jendelaMulai, mulai),
        sql`${pembatasLaju.jumlah} < ${BATAS_UNGGAH_PER_JAM}`,
      ),
    })
    .returning({ jumlah: pembatasLaju.jumlah });

  return terpakai.length === 1
    ? { boleh: true }
    : { boleh: false, cobaLagiPada: cobaLagiPada(sekarang, JENDELA_UNGGAH_MS) };
}
