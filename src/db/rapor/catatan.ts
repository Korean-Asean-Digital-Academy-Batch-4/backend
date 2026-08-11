import { eq, sql } from "drizzle-orm";

import { bolehDiubahGuru } from "../../domain/rapor.js";
import type { BasisData } from "../drizzle.js";
import { rapor } from "../skema/rapor.js";
import { bolehTulisRapor, cariRapor, type Penuntut } from "./akses.js";

/**
 * Catatan wali kelas — [API.md §8.2].
 *
 * **Catatan bersifat per siswa**, mengikuti `rapor.catatan_wali`. "Catatan
 * umum" pada [PRD §6.3] dibaca sebagai catatan yang berlaku atas seluruh mata
 * pelajaran satu siswa, bukan satu catatan untuk seluruh kelas.
 *
 * Hanya dapat diubah selama rapor berstatus `draft`; sesudahnya `409
 * RAPOR_TERKUNCI` — I-22 dan AC-14.
 */

export const BATAS_CATATAN_WALI = 1000;

export type JenisGalatCatatan = "tidak_ditemukan" | "kewenangan_ditolak" | "rapor_terkunci";

export type HasilCatatan =
  | Readonly<{ berhasil: true; data: Readonly<{ id: string; catatanWali: string | null }> }>
  | Readonly<{ berhasil: false; jenis: JenisGalatCatatan; pesan: string }>;

export async function simpanCatatanWali(
  db: BasisData,
  masukan: Readonly<{ raporRef: string; catatanWali: string | null; penuntut: Penuntut }>,
): Promise<HasilCatatan> {
  return db.transaction(async (tx) => {
    // Baris dikunci supaya pemeriksaan status dan penulisannya tidak dapat
    // disisipi finalisasi yang berjalan bersamaan.
    const [terkunci] = await tx
      .select({ id: rapor.id })
      .from(rapor)
      .where(eq(rapor.id, masukan.raporRef))
      .for("update");

    const satu = terkunci ? await cariRapor(tx, masukan.raporRef) : undefined;
    if (!satu) {
      return {
        berhasil: false as const,
        jenis: "tidak_ditemukan" as const,
        pesan: "Rapor tidak ditemukan.",
      };
    }

    if (!bolehTulisRapor(satu, masukan.penuntut)) {
      return {
        berhasil: false as const,
        jenis: "kewenangan_ditolak" as const,
        pesan: "Anda tidak berwenang menulis catatan pada rapor ini.",
      };
    }

    // Administrator pun tidak melewati kunci ini: catatan wali adalah bagian
    // rapor yang dibekukan finalisasi, dan I-21 tidak menyediakan jalan mundur.
    if (!bolehDiubahGuru(satu.status)) {
      return {
        berhasil: false as const,
        jenis: "rapor_terkunci" as const,
        pesan: "Rapor sudah final. Catatan wali tidak dapat diubah lagi.",
      };
    }

    const [diperbarui] = await tx
      .update(rapor)
      .set({ catatanWali: masukan.catatanWali })
      .where(sql`${rapor.id} = ${masukan.raporRef}`)
      .returning({ id: rapor.id, catatanWali: rapor.catatanWali });

    return {
      berhasil: true as const,
      data: Object.freeze({ id: diperbarui!.id, catatanWali: diperbarui!.catatanWali }),
    };
  });
}
