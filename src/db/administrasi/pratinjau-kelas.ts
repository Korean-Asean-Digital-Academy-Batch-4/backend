import { and, eq, inArray } from "drizzle-orm";

import type {
  BarisSiswa,
  HasilUrai,
  RincianSiswaBermasalah,
} from "../../ports/berkas-administrasi.js";
import type { BasisData } from "../drizzle.js";
import { pengguna, siswa } from "../skema/identitas.js";
import { kelas, kelasSiswa, periode } from "../skema/periode.js";
import type { HasilAdministrasi } from "./hasil.js";

export type PratinjauKelas = Readonly<{
  kelasBerkas: string | null;
  cocok: readonly Readonly<{
    baris: number;
    nis: string;
    namaBerkas: string;
    namaSistem: string;
    siswaRef: string;
  }>[];
  bermasalah: readonly RincianSiswaBermasalah[];
}>;

type SiswaDitemukan = Readonly<{
  siswaRef: string;
  nis: string;
  nama: string;
  keanggotaanRef: string | null;
  kelasNama: string | null;
}>;

export async function pratinjauKelas(
  db: BasisData,
  periodeRef: string,
  hasilUrai: HasilUrai<BarisSiswa, RincianSiswaBermasalah>,
): Promise<HasilAdministrasi<PratinjauKelas>> {
  const [periodeAda] = await db
    .select({ id: periode.id })
    .from(periode)
    .where(eq(periode.id, periodeRef))
    .limit(1);
  if (!periodeAda) {
    return {
      berhasil: false,
      jenis: "tidak_ditemukan",
      pesan: "Periode sasaran tidak ditemukan.",
    };
  }
  if (!hasilUrai.berhasil) {
    return { berhasil: false, jenis: "berkas_tidak_sah", pesan: hasilUrai.sebab };
  }

  const ditemukan = await cariSiswa(db, periodeRef, hasilUrai.valid);
  return {
    berhasil: true,
    data: bentukPratinjau(hasilUrai.valid, hasilUrai.bermasalah, ditemukan),
  };
}

async function cariSiswa(
  db: BasisData,
  periodeRef: string,
  baris: readonly BarisSiswa[],
): Promise<ReadonlyMap<string, SiswaDitemukan>> {
  const nis = Object.freeze([...new Set(baris.map((item) => item.nis))]);
  if (nis.length === 0) return new Map();

  const hasil = await db
    .select({
      siswaRef: siswa.penggunaRef,
      nis: pengguna.namaPengguna,
      nama: pengguna.nama,
      keanggotaanRef: kelasSiswa.id,
      kelasNama: kelas.nama,
    })
    .from(siswa)
    .innerJoin(pengguna, eq(pengguna.id, siswa.penggunaRef))
    .leftJoin(
      kelasSiswa,
      and(eq(kelasSiswa.siswaRef, siswa.penggunaRef), eq(kelasSiswa.periodeRef, periodeRef)),
    )
    .leftJoin(kelas, eq(kelas.id, kelasSiswa.kelasRef))
    .where(inArray(pengguna.namaPengguna, nis));

  return new Map(hasil.map((item) => [item.nis, Object.freeze(item)]));
}

function bentukPratinjau(
  baris: readonly BarisSiswa[],
  masalahParser: readonly RincianSiswaBermasalah[],
  ditemukan: ReadonlyMap<string, SiswaDitemukan>,
): PratinjauKelas {
  const kelasMasalah = masalahParser
    .map((item) => item.kelas)
    .filter((item): item is string => item !== undefined);
  const kelasUnik = new Set([...baris.map((item) => item.kelas), ...kelasMasalah].filter(Boolean));
  const kelasBerkas = kelasUnik.size === 1 ? [...kelasUnik][0]! : null;
  const kelasBercampur = kelasUnik.size > 1;
  const cocok: Array<PratinjauKelas["cocok"][number]> = [];
  const bermasalah: RincianSiswaBermasalah[] = masalahParser.map((item) =>
    Object.freeze({
      baris: item.baris,
      nis: item.nis,
      sebab:
        kelasBercampur && item.kelas
          ? gabungSebab(item.sebab, "Nilai Kelas tidak konsisten di dalam berkas")
          : item.sebab,
    }),
  );
  const nisDilihat = new Set<string>();

  for (const item of [...baris].sort((a, b) => a.baris - b.baris)) {
    const sebab = tentukanMasalah(item, ditemukan.get(item.nis), nisDilihat, kelasBercampur);
    nisDilihat.add(item.nis);
    if (sebab) {
      bermasalah.push(Object.freeze({ baris: item.baris, nis: item.nis, sebab }));
      continue;
    }

    const siswaAda = ditemukan.get(item.nis)!;
    cocok.push(
      Object.freeze({
        baris: item.baris,
        nis: item.nis,
        namaBerkas: item.nama,
        namaSistem: siswaAda.nama,
        siswaRef: siswaAda.siswaRef,
      }),
    );
  }

  bermasalah.sort((a, b) => a.baris - b.baris);
  return Object.freeze({
    kelasBerkas,
    cocok: Object.freeze(cocok),
    bermasalah: Object.freeze(bermasalah.map((item) => Object.freeze({ ...item }))),
  });
}

function gabungSebab(awal: string, tambahan: string): string {
  return awal.split("; ").includes(tambahan) ? awal : `${awal}; ${tambahan}`;
}

function tentukanMasalah(
  item: BarisSiswa,
  siswaAda: SiswaDitemukan | undefined,
  nisDilihat: ReadonlySet<string>,
  kelasBercampur: boolean,
): string | undefined {
  if (siswaAda?.keanggotaanRef && !siswaAda.kelasNama) {
    throw new Error("Keanggotaan siswa tidak memiliki kelas.");
  }
  const sebab = [
    ...(kelasBercampur ? ["Nilai Kelas tidak konsisten di dalam berkas"] : []),
    ...(nisDilihat.has(item.nis) ? ["NIS ganda di dalam berkas"] : []),
    ...(!siswaAda
      ? ["NIS tidak terdaftar sebagai akun siswa"]
      : siswaAda.keanggotaanRef
        ? [`Sudah terdaftar pada kelas ${siswaAda.kelasNama!} pada semester ini`]
        : []),
  ];
  return sebab.length > 0 ? sebab.join("; ") : undefined;
}
