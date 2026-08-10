import { asc, eq } from "drizzle-orm";
import { DatabaseError } from "pg";

import type { BasisData } from "../drizzle.js";
import { guru, pengguna } from "../skema/identitas.js";
import { mapel } from "../skema/kurikulum.js";
import type { HasilAdministrasi } from "./hasil.js";

export type Tingkat = "X" | "XI" | "XII";
export type MapelBaru = Readonly<{
  kode: string;
  nama: string;
  tingkat: Tingkat;
  kkm?: number;
  guruRef: string;
}>;
export type PerubahanMapel = Readonly<{ nama?: string; kkm?: number }>;
export type MapelDenganGuru = Readonly<{
  id: string;
  kode: string;
  nama: string;
  tingkat: Tingkat;
  kkm: number;
  guru: Readonly<{ id: string; nama: string; namaPengguna: string }>;
}>;

const PELANGGARAN_UNIK = "23505";
const PELANGGARAN_KUNCI_ASING = "23503";
type PembacaMapel = Pick<BasisData, "select">;

export async function buatMapel(
  db: BasisData,
  input: MapelBaru,
): Promise<HasilAdministrasi<MapelDenganGuru>> {
  try {
    return await db.transaction(async (tx) => {
      const [dibuat] = await tx
        .insert(mapel)
        .values({
          kode: input.kode,
          nama: input.nama,
          tingkat: input.tingkat,
          ...(input.kkm === undefined ? {} : { kkm: input.kkm }),
          guruRef: input.guruRef,
        })
        .returning({ id: mapel.id });
      if (!dibuat) throw new Error("Pembuatan mapel tidak mengembalikan baris.");
      const hasil = await cariMapel(tx, dibuat.id);
      if (!hasil) throw new Error("Mapel yang baru dibuat tidak dapat dibaca kembali.");
      return { berhasil: true, data: hasil };
    });
  } catch (galat) {
    const postgres = galatPostgres(galat);
    if (postgres?.code === PELANGGARAN_UNIK && postgres.constraint === "uq_mapel_kode") {
      return {
        berhasil: false,
        jenis: "data_sudah_ada",
        pesan: "Kode mata pelajaran sudah dipakai.",
      };
    }
    if (postgres?.code === PELANGGARAN_UNIK && postgres.constraint === "uq_mapel_guru") {
      return {
        berhasil: false,
        jenis: "guru_sudah_mengampu",
        pesan: "Guru tersebut sudah mengampu mata pelajaran.",
      };
    }
    if (
      postgres?.code === PELANGGARAN_KUNCI_ASING &&
      postgres.constraint === "mapel_guru_ref_fkey"
    ) {
      return {
        berhasil: false,
        jenis: "tidak_ditemukan",
        pesan: "Guru tidak ditemukan.",
      };
    }
    throw galat;
  }
}

export async function daftarMapel(db: BasisData): Promise<readonly MapelDenganGuru[]> {
  const hasil = await kueriMapel(db).orderBy(asc(mapel.tingkat), asc(mapel.kode), asc(mapel.id));
  return Object.freeze(hasil.map(bekukanMapel));
}

export async function ubahMapel(
  db: BasisData,
  mapelRef: string,
  input: PerubahanMapel,
): Promise<HasilAdministrasi<MapelDenganGuru>> {
  return db.transaction(async (tx) => {
    const diubah = await tx
      .update(mapel)
      .set({
        ...(input.nama === undefined ? {} : { nama: input.nama }),
        ...(input.kkm === undefined ? {} : { kkm: input.kkm }),
        diperbaruiPada: new Date(),
      })
      .where(eq(mapel.id, mapelRef))
      .returning({ id: mapel.id });
    if (diubah.length === 0) {
      return {
        berhasil: false,
        jenis: "tidak_ditemukan",
        pesan: "Mata pelajaran tidak ditemukan.",
      };
    }
    const hasil = await cariMapel(tx, mapelRef);
    if (!hasil) throw new Error("Mapel yang diubah tidak dapat dibaca kembali.");
    return { berhasil: true, data: hasil };
  });
}

function kueriMapel(db: PembacaMapel) {
  return db
    .select({
      id: mapel.id,
      kode: mapel.kode,
      nama: mapel.nama,
      tingkat: mapel.tingkat,
      kkm: mapel.kkm,
      guruId: pengguna.id,
      guruNama: pengguna.nama,
      guruNamaPengguna: pengguna.namaPengguna,
    })
    .from(mapel)
    .innerJoin(guru, eq(guru.penggunaRef, mapel.guruRef))
    .innerJoin(pengguna, eq(pengguna.id, guru.penggunaRef));
}

async function cariMapel(db: PembacaMapel, mapelRef: string): Promise<MapelDenganGuru | undefined> {
  const [hasil] = await kueriMapel(db).where(eq(mapel.id, mapelRef)).limit(1);
  return hasil ? bekukanMapel(hasil) : undefined;
}

type BarisMapel = Readonly<{
  id: string;
  kode: string;
  nama: string;
  tingkat: string;
  kkm: number;
  guruId: string;
  guruNama: string;
  guruNamaPengguna: string;
}>;

function bekukanMapel(baris: BarisMapel): MapelDenganGuru {
  if (baris.tingkat !== "X" && baris.tingkat !== "XI" && baris.tingkat !== "XII") {
    throw new Error("Mapel memiliki tingkat di luar kontrak.");
  }
  return Object.freeze({
    id: baris.id,
    kode: baris.kode,
    nama: baris.nama,
    tingkat: baris.tingkat,
    kkm: baris.kkm,
    guru: Object.freeze({
      id: baris.guruId,
      nama: baris.guruNama,
      namaPengguna: baris.guruNamaPengguna,
    }),
  });
}

type GalatPostgres = Readonly<{ code?: string; constraint?: string }>;

function galatPostgres(galat: unknown): GalatPostgres | undefined {
  let saatIni = galat;
  const sudahDilihat = new Set<unknown>();
  while (typeof saatIni === "object" && saatIni !== null && !sudahDilihat.has(saatIni)) {
    sudahDilihat.add(saatIni);
    if (saatIni instanceof DatabaseError) {
      return {
        code: saatIni.code,
        constraint: saatIni.constraint,
      };
    }
    saatIni = "cause" in saatIni ? (saatIni as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}
