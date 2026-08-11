import { asc, inArray, sql } from "drizzle-orm";

import { periksaTransisi } from "../../domain/rapor.js";
import type { BasisData } from "../drizzle.js";
import { rapor } from "../skema/rapor.js";
import { cariKonteksKelas, keStatus } from "./kesiapan.js";

/**
 * Distribusi rapor sekelas — [API.md §8.4].
 *
 * Mengubah status seluruh rapor kelas menjadi `distributed`. Sejak saat itu
 * Siswa yang bersangkutan dapat melihat dan mengunduhnya (UC-16, AC-10).
 *
 * Tidak ada berkas yang dirender di sini: berkasnya sudah ada sejak finalisasi,
 * dan yang belum ada diselesaikan jalur unduh ([API.md §8.4]).
 */

export type JenisGalatDistribusi = "tidak_ditemukan" | "tanpa_rapor" | "belum_final";

export type HasilDistribusi =
  | Readonly<{
      berhasil: true;
      data: Readonly<{ didistribusikan: number; didistribusikanPada: Date }>;
    }>
  | Readonly<{ berhasil: false; jenis: JenisGalatDistribusi; pesan: string }>;

export async function distribusiKelas(
  db: BasisData,
  masukan: Readonly<{ kelasRef: string; sekarang: () => Date }>,
): Promise<HasilDistribusi> {
  const konteks = await cariKonteksKelas(db, masukan.kelasRef);
  if (!konteks) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Kelas tidak ditemukan." };
  }

  return db.transaction(async (tx) => {
    const barisRapor = await tx
      .select({ id: rapor.id, status: rapor.status })
      .from(rapor)
      .where(
        sql`${rapor.kelasRef} = ${masukan.kelasRef} AND ${rapor.periodeRef} = ${konteks.periodeRef}`,
      )
      .orderBy(asc(rapor.id))
      .for("update");

    if (barisRapor.length === 0) {
      return {
        berhasil: false as const,
        jenis: "tanpa_rapor" as const,
        pesan:
          "Kelas ini belum memiliki satu pun siswa, sehingga rapornya tidak dapat didistribusikan.",
      };
    }

    // I-21 diperiksa lebih dahulu supaya pesannya menyebut alasan, bukan
    // menunggu `trg_rapor_status_maju` menolak dengan teks pemicunya.
    const tidakSah = barisRapor.find(
      (satu) => !periksaTransisi(keStatus(satu.status), "distributed").sah,
    );
    if (tidakSah) {
      return {
        berhasil: false as const,
        jenis: "belum_final" as const,
        pesan:
          keStatus(tidakSah.status) === "distributed"
            ? "Rapor kelas ini sudah didistribusikan."
            : "Rapor kelas ini belum difinalisasi, sehingga belum dapat didistribusikan.",
      };
    }

    const didistribusikanPada = masukan.sekarang();
    await tx
      .update(rapor)
      .set({ status: "distributed", didistribusikanPada })
      .where(
        inArray(
          rapor.id,
          barisRapor.map((satu) => satu.id),
        ),
      );

    return {
      berhasil: true as const,
      data: Object.freeze({ didistribusikan: barisRapor.length, didistribusikanPada }),
    };
  });
}
