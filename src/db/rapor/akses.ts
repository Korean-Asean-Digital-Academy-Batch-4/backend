import { eq, sql } from "drizzle-orm";

import type { StatusRapor } from "../../domain/rapor.js";
import { terlihatSiswa } from "../../domain/rapor.js";
import { kelas } from "../skema/periode.js";
import { rapor } from "../skema/rapor.js";
import { keStatus, type Pelaksana } from "./kesiapan.js";

/**
 * Lapis baris rapor — [ARCHITECTURE.md §9.2] dan [API.md §8.4].
 *
 * Administrator tanpa batas; Wali Kelas hanya kelas walinya; Siswa hanya rapor
 * miliknya **dan** yang sudah berstatus `distributed`. Guru Mata Pelajaran
 * ditolak pada setiap rapor tanpa aturan terpisah — AC-32 dan P23 memang
 * mencabut seluruh jalur unduh dan finalisasi darinya.
 */

export type RaporSatu = Readonly<{
  id: string;
  siswaRef: string;
  kelasRef: string;
  periodeRef: string;
  status: StatusRapor;
  catatanWali: string | null;
  kunciBerkas: string | null;
  waliKelasRef: string | null;
}>;

export type Penuntut = Readonly<{ penggunaRef: string; peran: string }>;

/** Satu rapor beserta wali kelas kelasnya — dasar seluruh pemeriksaan lapis baris. */
export async function cariRapor(
  pelaksana: Pelaksana,
  raporRef: string,
): Promise<RaporSatu | undefined> {
  const [baris] = await pelaksana
    .select({
      id: rapor.id,
      siswaRef: rapor.siswaRef,
      kelasRef: rapor.kelasRef,
      periodeRef: rapor.periodeRef,
      status: rapor.status,
      catatanWali: rapor.catatanWali,
      kunciBerkas: rapor.kunciBerkas,
      waliKelasRef: kelas.waliKelasRef,
    })
    .from(rapor)
    .innerJoin(kelas, eq(kelas.id, rapor.kelasRef))
    .where(eq(rapor.id, raporRef))
    .limit(1);

  if (!baris) return undefined;
  return Object.freeze({ ...baris, status: keStatus(baris.status) });
}

/** Apakah penuntut adalah Wali Kelas dari kelas yang bersangkutan. */
export async function adalahWaliKelas(
  pelaksana: Pelaksana,
  kelasRef: string,
  penggunaRef: string,
): Promise<boolean> {
  const [baris] = await pelaksana
    .select({ id: kelas.id })
    .from(kelas)
    .where(sql`${kelas.id} = ${kelasRef} AND ${kelas.waliKelasRef} = ${penggunaRef}`)
    .limit(1);
  return baris !== undefined;
}

/**
 * Bolehkah penuntut **mengunduh** rapor ini.
 *
 * Guru Mata Pelajaran tidak muncul sebagai cabang tersendiri: ia berperan
 * `guru`, dan satu-satunya cabang `guru` menuntut ia menjadi wali kelas kelas
 * tersebut. Guru yang mengajar di kelas itu tanpa menjadi walinya karenanya
 * ditolak oleh aturan yang sama — AC-32.
 */
export function bolehUnduhRapor(satu: RaporSatu, penuntut: Penuntut): boolean {
  if (penuntut.peran === "administrator") return true;
  if (penuntut.peran === "guru") return satu.waliKelasRef === penuntut.penggunaRef;
  if (penuntut.peran === "siswa") {
    return satu.siswaRef === penuntut.penggunaRef && terlihatSiswa(satu.status);
  }
  return false;
}

/** Bolehkah penuntut **menulis** pada rapor ini — catatan wali (aktor-role §6). */
export function bolehTulisRapor(satu: RaporSatu, penuntut: Penuntut): boolean {
  if (penuntut.peran === "administrator") return true;
  if (penuntut.peran === "guru") return satu.waliKelasRef === penuntut.penggunaRef;
  return false;
}
