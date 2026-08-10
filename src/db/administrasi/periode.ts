import { asc, desc, eq, sql } from "drizzle-orm";

import type { BasisData } from "../drizzle.js";
import { periode, tahunAjaran } from "../skema/periode.js";
import type { HasilAdministrasi } from "./hasil.js";

export type TahunAjaranBaru = Readonly<{
  nama: string;
  tglMulai: string;
  tglSelesai: string;
}>;
export type TahunAjaranRingkas = TahunAjaranBaru & Readonly<{ id: string; aktif: boolean }>;
export type PeriodeBaru = Readonly<{
  semester: "ganjil" | "genap";
  tglMulai: string;
  tglSelesai: string;
}>;
export type PeriodeDibuat = PeriodeBaru &
  Readonly<{ id: string; tahunAjaranRef: string; aktif: boolean }>;
export type PeriodeDalamTahun = PeriodeBaru & Readonly<{ id: string; aktif: boolean }>;
export type TahunAjaranDenganPeriode = TahunAjaranRingkas &
  Readonly<{ periode: readonly PeriodeDalamTahun[] }>;

const PELANGGARAN_UNIK = "23505";
const PELANGGARAN_KUNCI_ASING = "23503";

export async function buatTahunAjaran(
  db: BasisData,
  input: TahunAjaranBaru,
): Promise<HasilAdministrasi<TahunAjaranRingkas>> {
  try {
    const [dibuat] = await db.insert(tahunAjaran).values(input).returning({
      id: tahunAjaran.id,
      nama: tahunAjaran.nama,
      tglMulai: tahunAjaran.tglMulai,
      tglSelesai: tahunAjaran.tglSelesai,
      aktif: tahunAjaran.aktif,
    });
    if (!dibuat) throw new Error("Pembuatan tahun ajaran tidak mengembalikan baris.");
    return { berhasil: true, data: Object.freeze({ ...dibuat }) };
  } catch (galat) {
    const postgres = galatPostgres(galat);
    if (postgres?.code === PELANGGARAN_UNIK && postgres.constraint === "uq_tahun_ajaran_nama") {
      return {
        berhasil: false,
        jenis: "data_sudah_ada",
        pesan: "Nama tahun ajaran sudah dipakai.",
      };
    }
    throw galat;
  }
}

export async function daftarTahunAjaran(
  db: BasisData,
): Promise<readonly TahunAjaranDenganPeriode[]> {
  const baris = await db
    .select({
      id: tahunAjaran.id,
      nama: tahunAjaran.nama,
      tglMulai: tahunAjaran.tglMulai,
      tglSelesai: tahunAjaran.tglSelesai,
      aktif: tahunAjaran.aktif,
      periodeId: periode.id,
      semester: periode.semester,
      periodeTglMulai: periode.tglMulai,
      periodeTglSelesai: periode.tglSelesai,
      periodeAktif: periode.aktif,
    })
    .from(tahunAjaran)
    .leftJoin(periode, eq(periode.tahunAjaranRef, tahunAjaran.id))
    .orderBy(
      desc(tahunAjaran.tglMulai),
      asc(tahunAjaran.id),
      asc(periode.tglMulai),
      asc(periode.id),
    );

  const daftar: Array<{
    tahun: TahunAjaranRingkas;
    periode: PeriodeDalamTahun[];
  }> = [];
  for (const item of baris) {
    let kelompok = daftar.at(-1);
    if (kelompok?.tahun.id !== item.id) {
      kelompok = {
        tahun: Object.freeze({
          id: item.id,
          nama: item.nama,
          tglMulai: item.tglMulai,
          tglSelesai: item.tglSelesai,
          aktif: item.aktif,
        }),
        periode: [],
      };
      daftar.push(kelompok);
    }
    if (item.periodeId !== null) {
      if (
        (item.semester !== "ganjil" && item.semester !== "genap") ||
        item.periodeTglMulai === null ||
        item.periodeTglSelesai === null ||
        item.periodeAktif === null
      ) {
        throw new Error("Periode pada daftar tahun ajaran tidak lengkap.");
      }
      kelompok.periode.push(
        Object.freeze({
          id: item.periodeId,
          semester: item.semester,
          tglMulai: item.periodeTglMulai,
          tglSelesai: item.periodeTglSelesai,
          aktif: item.periodeAktif,
        }),
      );
    }
  }

  return Object.freeze(
    daftar.map((item) =>
      Object.freeze({ ...item.tahun, periode: Object.freeze([...item.periode]) }),
    ),
  );
}

export async function buatPeriode(
  db: BasisData,
  tahunAjaranRef: string,
  input: PeriodeBaru,
): Promise<HasilAdministrasi<PeriodeDibuat>> {
  const [induk] = await db
    .select({ id: tahunAjaran.id })
    .from(tahunAjaran)
    .where(eq(tahunAjaran.id, tahunAjaranRef))
    .limit(1);
  if (!induk) {
    return {
      berhasil: false,
      jenis: "tidak_ditemukan",
      pesan: "Tahun ajaran tidak ditemukan.",
    };
  }

  try {
    const [dibuat] = await db
      .insert(periode)
      .values({ ...input, tahunAjaranRef })
      .returning({
        id: periode.id,
        tahunAjaranRef: periode.tahunAjaranRef,
        semester: periode.semester,
        tglMulai: periode.tglMulai,
        tglSelesai: periode.tglSelesai,
        aktif: periode.aktif,
      });
    if (!dibuat || (dibuat.semester !== "ganjil" && dibuat.semester !== "genap")) {
      throw new Error("Pembuatan periode tidak mengembalikan baris yang sah.");
    }
    return {
      berhasil: true,
      data: Object.freeze({
        id: dibuat.id,
        tahunAjaranRef: dibuat.tahunAjaranRef,
        semester: dibuat.semester,
        tglMulai: dibuat.tglMulai,
        tglSelesai: dibuat.tglSelesai,
        aktif: dibuat.aktif,
      }),
    };
  } catch (galat) {
    const postgres = galatPostgres(galat);
    if (
      postgres?.code === PELANGGARAN_UNIK &&
      postgres.constraint === "uq_periode_tahun_semester"
    ) {
      return {
        berhasil: false,
        jenis: "data_sudah_ada",
        pesan: "Semester tersebut sudah terdaftar pada tahun ajaran ini.",
      };
    }
    if (
      postgres?.code === PELANGGARAN_KUNCI_ASING &&
      postgres.constraint === "periode_tahun_ajaran_ref_fkey"
    ) {
      return {
        berhasil: false,
        jenis: "tidak_ditemukan",
        pesan: "Tahun ajaran tidak ditemukan.",
      };
    }
    throw galat;
  }
}

export async function aktifkanPeriode(
  db: BasisData,
  periodeRef: string,
): Promise<HasilAdministrasi<null>> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ tahunAjaranRef: periode.tahunAjaranRef })
      .from(periode)
      .where(eq(periode.id, periodeRef))
      .limit(1);
    if (!target) {
      return {
        berhasil: false,
        jenis: "tidak_ditemukan",
        pesan: "Periode tidak ditemukan.",
      };
    }

    // Semua aktivasi dalam tahun yang sama mengambil kunci induk yang sama.
    // Ini menyerialkan target berbeda sebelum perubahan I-03 dimulai.
    await tx.execute(sql`SELECT ${tahunAjaran.id} FROM ${tahunAjaran}
      WHERE ${tahunAjaran.id} = ${target.tahunAjaranRef} FOR UPDATE`);
    await tx
      .update(periode)
      .set({ aktif: false })
      .where(eq(periode.tahunAjaranRef, target.tahunAjaranRef));
    const diaktifkan = await tx
      .update(periode)
      .set({ aktif: true })
      .where(eq(periode.id, periodeRef))
      .returning({ id: periode.id });
    if (diaktifkan.length !== 1) throw new Error("Target periode hilang selama aktivasi.");
    return { berhasil: true, data: null };
  });
}

type GalatPostgres = Readonly<{ code?: string; constraint?: string }>;

function galatPostgres(galat: unknown): GalatPostgres | undefined {
  let saatIni = galat;
  const sudahDilihat = new Set<unknown>();
  while (typeof saatIni === "object" && saatIni !== null && !sudahDilihat.has(saatIni)) {
    sudahDilihat.add(saatIni);
    if ("code" in saatIni) {
      const postgres = saatIni as { code?: unknown; constraint?: unknown };
      return {
        code: typeof postgres.code === "string" ? postgres.code : undefined,
        constraint: typeof postgres.constraint === "string" ? postgres.constraint : undefined,
      };
    }
    saatIni = "cause" in saatIni ? (saatIni as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}
