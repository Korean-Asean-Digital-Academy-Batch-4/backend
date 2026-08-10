import { asc, eq } from "drizzle-orm";

import type { BasisData } from "../drizzle.js";
import { komponenPenilaian, penugasanKomponen } from "../skema/kurikulum.js";
import { nilai } from "../skema/pencatatan.js";
import type { HasilAdministrasi } from "./hasil.js";

export type KomponenMasukan = Readonly<{
  kode: string;
  nama: string;
  bobot: number;
  urutan: number;
}>;
export type KomponenRingkas = KomponenMasukan & Readonly<{ id: string }>;

const TOTAL_BOBOT = 100;
const SMALLINT_MIN = -32_768;
const SMALLINT_MAX = 32_767;

export async function daftarKomponen(db: BasisData): Promise<readonly KomponenRingkas[]> {
  const hasil = await db
    .select({
      id: komponenPenilaian.id,
      kode: komponenPenilaian.kode,
      nama: komponenPenilaian.nama,
      bobot: komponenPenilaian.bobot,
      urutan: komponenPenilaian.urutan,
    })
    .from(komponenPenilaian)
    .orderBy(asc(komponenPenilaian.urutan), asc(komponenPenilaian.id));
  return bekukanDaftar(hasil);
}

export async function gantiKomponen(
  db: BasisData,
  input: readonly KomponenMasukan[],
): Promise<HasilAdministrasi<readonly KomponenRingkas[]>> {
  const total = input.reduce((jumlah, item) => jumlah + item.bobot, 0);
  if (total !== TOTAL_BOBOT) {
    return {
      berhasil: false,
      jenis: "bobot_tidak_seratus",
      pesan: `Jumlah bobot komponen penilaian harus tepat 100%, saat ini ${total}%.`,
    };
  }
  if (
    adaDuplikat(input.map((item) => item.kode)) ||
    adaDuplikat(input.map((item) => item.urutan))
  ) {
    return {
      berhasil: false,
      jenis: "data_sudah_ada",
      pesan: "Kode dan urutan komponen penilaian tidak boleh berulang.",
    };
  }

  return db.transaction(async (tx) => {
    const tersimpan = await tx
      .select({
        id: komponenPenilaian.id,
        kode: komponenPenilaian.kode,
        nama: komponenPenilaian.nama,
        bobot: komponenPenilaian.bobot,
        urutan: komponenPenilaian.urutan,
      })
      .from(komponenPenilaian)
      .orderBy(asc(komponenPenilaian.id))
      .for("update");
    const [pemakaian] = await tx
      .select({ komponenRef: penugasanKomponen.komponenRef })
      .from(penugasanKomponen)
      .limit(1);
    const [nilaiTersimpan] = await tx
      .select({ komponenRef: nilai.komponenRef })
      .from(nilai)
      .limit(1);

    if (!pemakaian && !nilaiTersimpan) {
      await tx.delete(komponenPenilaian);
      if (input.length > 0) await tx.insert(komponenPenilaian).values([...input]);
    } else {
      const kodeTersimpan = [...tersimpan.map((item) => item.kode)].sort();
      const kodeMasukan = [...input.map((item) => item.kode)].sort();
      if (!daftarSama(kodeTersimpan, kodeMasukan)) {
        return {
          berhasil: false,
          jenis: "komponen_sudah_dipakai",
          pesan: "Kode komponen tidak dapat diubah karena templat sudah dipakai.",
        };
      }

      const urutanSementara = pilihUrutanSementara(
        tersimpan.map((item) => item.urutan),
        input.map((item) => item.urutan),
      );
      for (const [indeks, item] of tersimpan.entries()) {
        const sementara = urutanSementara[indeks];
        if (sementara === undefined) throw new Error("Urutan sementara tidak lengkap.");
        await tx
          .update(komponenPenilaian)
          .set({ urutan: sementara })
          .where(eq(komponenPenilaian.id, item.id));
      }

      for (const item of input) {
        const diubah = await tx
          .update(komponenPenilaian)
          .set({ nama: item.nama, bobot: item.bobot, urutan: item.urutan })
          .where(eq(komponenPenilaian.kode, item.kode))
          .returning({ id: komponenPenilaian.id });
        if (diubah.length !== 1) throw new Error("Pembaruan komponen tidak tepat satu baris.");
      }
    }

    const hasil = await tx
      .select({
        id: komponenPenilaian.id,
        kode: komponenPenilaian.kode,
        nama: komponenPenilaian.nama,
        bobot: komponenPenilaian.bobot,
        urutan: komponenPenilaian.urutan,
      })
      .from(komponenPenilaian)
      .orderBy(asc(komponenPenilaian.urutan), asc(komponenPenilaian.id));
    return { berhasil: true, data: bekukanDaftar(hasil) };
  });
}

function adaDuplikat<T>(nilai: readonly T[]): boolean {
  return new Set(nilai).size !== nilai.length;
}

function daftarSama(kiri: readonly string[], kanan: readonly string[]): boolean {
  return kiri.length === kanan.length && kiri.every((item, indeks) => item === kanan[indeks]);
}

/**
 * Constraint urutan tidak deferrable. Seluruh baris dipindahkan dahulu ke slot
 * smallint yang tidak dipakai nilai lama maupun nilai akhir, baru fase final.
 */
function pilihUrutanSementara(
  lama: readonly number[],
  akhir: readonly number[],
): readonly number[] {
  const terlarang = new Set([...lama, ...akhir]);
  const hasil: number[] = [];
  for (let calon = SMALLINT_MIN; calon <= SMALLINT_MAX && hasil.length < lama.length; calon += 1) {
    if (!terlarang.has(calon)) hasil.push(calon);
  }
  if (hasil.length !== lama.length) {
    throw new Error("Tidak tersedia urutan sementara untuk pembaruan komponen.");
  }
  return Object.freeze(hasil);
}

function bekukanDaftar(input: readonly KomponenRingkas[]): readonly KomponenRingkas[] {
  return Object.freeze(input.map((item) => Object.freeze({ ...item })));
}
