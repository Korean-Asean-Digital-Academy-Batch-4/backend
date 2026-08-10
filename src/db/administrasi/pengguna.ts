import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { guru, pengguna, siswa } from "../skema/identitas.js";
import { sesiMasuk } from "../skema/penopang.js";
import type { BasisData } from "../drizzle.js";
import type { HasilAdministrasi } from "./hasil.js";

export type PenggunaRingkas = Readonly<{
  id: string;
  nama: string;
  namaPengguna: string;
  peran: "guru" | "siswa";
  aktif: boolean;
}>;

export type PenggunaTersandiBaru = Readonly<{
  nama: string;
  namaPengguna: string;
  peran: "guru" | "siswa";
  kataSandiHash: string;
}>;

export type PenggunaTersandiUnggah = PenggunaTersandiBaru & Readonly<{ baris: number }>;
export type CalonPenggunaUnggah = Readonly<{ baris: number; namaPengguna: string }>;
export type RincianKonflikPengguna = Readonly<{ baris: number; sebab: string }>;

const PELANGGARAN_UNIK = "23505";

export async function buatPengguna(
  db: BasisData,
  input: PenggunaTersandiBaru,
): Promise<HasilAdministrasi<PenggunaRingkas>> {
  try {
    const baru = await db.transaction(async (tx) => {
      const [baris] = await tx
        .insert(pengguna)
        .values({
          nama: input.nama,
          namaPengguna: input.namaPengguna,
          peran: input.peran,
          kataSandiHash: input.kataSandiHash,
        })
        .returning({
          id: pengguna.id,
          nama: pengguna.nama,
          namaPengguna: pengguna.namaPengguna,
          peran: pengguna.peran,
          aktif: pengguna.aktif,
        });
      if (!baris || (baris.peran !== "guru" && baris.peran !== "siswa")) {
        throw new Error("Pembuatan pengguna tidak mengembalikan baris.");
      }

      if (input.peran === "guru") {
        await tx.insert(guru).values({ penggunaRef: baris.id });
      } else {
        await tx.insert(siswa).values({ penggunaRef: baris.id });
      }
      return bekukanPengguna(baris as PenggunaRingkas);
    });
    return { berhasil: true, data: baru };
  } catch (galat) {
    const postgres = galatPostgres(galat);
    if (
      postgres?.code === PELANGGARAN_UNIK &&
      postgres.constraint === "uq_pengguna_nama_pengguna"
    ) {
      return {
        berhasil: false,
        jenis: "data_sudah_ada",
        pesan: "Nama pengguna sudah dipakai oleh akun lain.",
      };
    }
    throw galat;
  }
}

export async function daftarPengguna(db: BasisData): Promise<readonly PenggunaRingkas[]> {
  const hasil = await db
    .select({
      id: pengguna.id,
      nama: pengguna.nama,
      namaPengguna: pengguna.namaPengguna,
      peran: pengguna.peran,
      aktif: pengguna.aktif,
    })
    .from(pengguna)
    .where(inArray(pengguna.peran, ["guru", "siswa"]))
    .orderBy(asc(pengguna.nama), asc(pengguna.id));

  return Object.freeze(
    hasil.map((baris) => {
      if (baris.peran !== "guru" && baris.peran !== "siswa") {
        throw new Error("Daftar pengguna memuat peran di luar cakupan.");
      }
      return bekukanPengguna(baris as PenggunaRingkas);
    }),
  );
}

/** Preflight baca-saja agar seluruh konflik DB dilaporkan sebelum Argon2 dimulai. */
export async function rincianKonflikPenggunaUnggah(
  db: BasisData,
  input: readonly CalonPenggunaUnggah[],
): Promise<readonly RincianKonflikPengguna[]> {
  const normal = Object.freeze([...new Set(input.map((item) => item.namaPengguna.toLowerCase()))]);
  if (normal.length === 0) return Object.freeze([]);

  const sudahAda = await db
    .select({ namaPengguna: pengguna.namaPengguna })
    .from(pengguna)
    .where(inArray(sql<string>`lower(${pengguna.namaPengguna})`, normal));
  const namaSudahAda = new Set(sudahAda.map((item) => item.namaPengguna.toLowerCase()));
  return Object.freeze(
    input.flatMap((item) =>
      namaSudahAda.has(item.namaPengguna.toLowerCase())
        ? [Object.freeze({ baris: item.baris, sebab: "Nama pengguna sudah terdaftar." })]
        : [],
    ),
  );
}

export async function buatBanyakPengguna(
  db: BasisData,
  input: readonly PenggunaTersandiUnggah[],
): Promise<HasilAdministrasi<readonly PenggunaRingkas[]>> {
  let barisBerjalan: PenggunaTersandiUnggah | undefined;
  try {
    return await db.transaction(async (tx) => {
      const frekuensi = hitungNamaPengguna(input);
      const normal = Object.freeze([...frekuensi.keys()]);
      const sudahAda =
        normal.length === 0
          ? []
          : await tx
              .select({ namaPengguna: pengguna.namaPengguna })
              .from(pengguna)
              .where(inArray(sql<string>`lower(${pengguna.namaPengguna})`, normal));
      const namaSudahAda = new Set(sudahAda.map((item) => item.namaPengguna.toLowerCase()));
      const rincian = input.flatMap((item) => {
        const kunci = item.namaPengguna.toLowerCase();
        if ((frekuensi.get(kunci) ?? 0) > 1) {
          return [{ baris: item.baris, sebab: "Nama pengguna muncul lebih dari sekali." }];
        }
        if (namaSudahAda.has(kunci)) {
          return [{ baris: item.baris, sebab: "Nama pengguna sudah terdaftar." }];
        }
        return [];
      });
      if (rincian.length > 0) return berkasTidakSah(input.length, rincian);

      const dibuat: PenggunaRingkas[] = [];
      for (const item of input) {
        barisBerjalan = item;
        const [baris] = await tx
          .insert(pengguna)
          .values({
            nama: item.nama,
            namaPengguna: item.namaPengguna,
            peran: item.peran,
            kataSandiHash: item.kataSandiHash,
          })
          .returning({
            id: pengguna.id,
            nama: pengguna.nama,
            namaPengguna: pengguna.namaPengguna,
            peran: pengguna.peran,
            aktif: pengguna.aktif,
          });
        if (!baris || (baris.peran !== "guru" && baris.peran !== "siswa")) {
          throw new Error("Pembuatan pengguna massal tidak mengembalikan baris.");
        }
        if (item.peran === "guru") {
          await tx.insert(guru).values({ penggunaRef: baris.id });
        } else {
          await tx.insert(siswa).values({ penggunaRef: baris.id });
        }
        dibuat.push(bekukanPengguna(baris as PenggunaRingkas));
      }
      return { berhasil: true as const, data: Object.freeze([...dibuat]) };
    });
  } catch (galat) {
    const postgres = galatPostgres(galat);
    if (
      postgres?.code === PELANGGARAN_UNIK &&
      postgres.constraint === "uq_pengguna_nama_pengguna" &&
      barisBerjalan
    ) {
      // Transaksi sudah rollback. Baca ulang seluruh batch agar beberapa nama
      // yang menang race bersamaan semuanya kembali ke nomor baris asalnya.
      const seluruhKonflik = await rincianKonflikPenggunaUnggah(db, input);
      return berkasTidakSah(
        input.length,
        seluruhKonflik.length > 0
          ? seluruhKonflik
          : [{ baris: barisBerjalan.baris, sebab: "Nama pengguna sudah terdaftar." }],
      );
    }
    throw galat;
  }
}

export async function resetKataSandi(
  db: BasisData,
  penggunaRef: string,
  hashBaru: string,
): Promise<HasilAdministrasi<null>> {
  return db.transaction(async (tx) => {
    const diperbarui = await tx
      .update(pengguna)
      .set({ kataSandiHash: hashBaru, diperbaruiPada: new Date() })
      .where(and(eq(pengguna.id, penggunaRef), inArray(pengguna.peran, ["guru", "siswa"])))
      .returning({ id: pengguna.id });
    if (diperbarui.length === 0) {
      return {
        berhasil: false,
        jenis: "tidak_ditemukan",
        pesan: "Akun Guru atau Siswa tidak ditemukan.",
      };
    }

    await tx.delete(sesiMasuk).where(eq(sesiMasuk.penggunaRef, penggunaRef));
    return { berhasil: true, data: null };
  });
}

function hitungNamaPengguna(input: readonly PenggunaTersandiUnggah[]): ReadonlyMap<string, number> {
  const hasil = new Map<string, number>();
  for (const item of input) {
    const kunci = item.namaPengguna.toLowerCase();
    hasil.set(kunci, (hasil.get(kunci) ?? 0) + 1);
  }
  return hasil;
}

function berkasTidakSah(
  jumlah: number,
  rincian: readonly Readonly<{ baris: number; sebab: string }>[],
): HasilAdministrasi<readonly PenggunaRingkas[]> {
  return {
    berhasil: false,
    jenis: "berkas_tidak_sah",
    pesan: `Berkas tidak dapat diproses. ${rincian.length} dari ${jumlah} baris bermasalah dan tidak ada akun yang dibuat.`,
    rincian: Object.freeze(rincian.map((item) => Object.freeze({ ...item }))),
  };
}

function bekukanPengguna(input: PenggunaRingkas): PenggunaRingkas {
  return Object.freeze({ ...input });
}

type GalatPostgres = Readonly<{ code?: string; constraint?: string }>;

function galatPostgres(galat: unknown): GalatPostgres | undefined {
  let saatIni = galat;
  const sudahDilihat = new Set<unknown>();
  while (typeof saatIni === "object" && saatIni !== null && !sudahDilihat.has(saatIni)) {
    sudahDilihat.add(saatIni);
    if ("code" in saatIni) {
      const pg = saatIni as { code?: unknown; constraint?: unknown };
      return {
        code: typeof pg.code === "string" ? pg.code : undefined,
        constraint: typeof pg.constraint === "string" ? pg.constraint : undefined,
      };
    }
    saatIni = "cause" in saatIni ? (saatIni as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}
