import { asc, eq, sql } from "drizzle-orm";

import type { BasisData } from "../drizzle.js";
import { pengguna, siswa } from "../skema/identitas.js";
import { komponenPenilaian, mapel, penugasan, penugasanKomponen } from "../skema/kurikulum.js";
import { nilai } from "../skema/pencatatan.js";
import { kelas, kelasSiswa, periode, tahunAjaran } from "../skema/periode.js";
import { rapor } from "../skema/rapor.js";
import { bentukNilaiAkhirSiswa, pivotBarisNilai } from "../../domain/siswa.js";

/**
 * Lapisan data nilai — API.md §6, ARCHITECTURE.md §14.1.
 *
 * Simpan Nilai adalah satu transaksi (C-02, P22, AC-15): sisip/perbarui baris
 * untuk nilai terisi, hapus baris untuk `null` — I-12. Seluruh `siswa_ref`
 * wajib anggota `kelas_siswa` penugasan (SCHEMA.md §11, S-01); seluruh
 * `komponen_ref` wajib snapshot `penugasan_komponen` penugasan tersebut.
 */

const PELANGGARAN_UNIK = "23505";
const PELANGGARAN_KUNCI_ASING = "23503";
const PELANGGARAN_PERIKSA = "23514";

export type JenisGalatNilai =
  | "tidak_ditemukan"
  | "kewenangan_ditolak"
  | "rapor_terkunci"
  | "siswa_asing"
  | "komponen_asing"
  | "permintaan_tidak_sah";

export type HasilNilai<T> =
  | Readonly<{ berhasil: true; data: T }>
  | Readonly<{ berhasil: false; jenis: JenisGalatNilai; pesan: string }>;

/** Konteks penugasan yang dipakai seluruh operasi nilai. */
export type KonteksPenugasan = Readonly<{
  id: string;
  kelasRef: string;
  kelasNama: string;
  mapelNama: string;
  kkm: number;
  periodeRef: string;
  guruRef: string;
}>;

/** Komponen snapshot penugasan — CK-API-15. */
export type KomponenSnapshot = Readonly<{
  id: string;
  kode: string;
  nama: string;
  bobot: number;
  urutan: number;
  topik: string | null;
}>;

export type SiswaKelas = Readonly<{ siswaRef: string; nama: string }>;

export type BarisNilaiDb = Readonly<{
  siswaRef: string;
  komponenRef: string;
  nilai: number;
}>;

export type MatriksNilai = Readonly<{
  penugasan: Readonly<{ id: string; kelasNama: string; mapelNama: string; kkm: number }>;
  komponen: readonly KomponenSnapshot[];
  siswa: readonly SiswaKelas[];
  nilai: readonly BarisNilaiDb[];
}>;

export type RingkasanSimpanNilai = Readonly<{ tersimpan: number; terhapus: number }>;

export type MasukanSimpanNilai = Readonly<{
  penugasanRef: string;
  penuntut: Readonly<{ penggunaRef: string; peran: string }>;
  nilai: readonly Readonly<{ siswaRef: string; komponenRef: string; nilai: number | null }>[];
  topik: readonly Readonly<{ komponenRef: string; topik: string | null }>[];
}>;

/** Memuat konteks penugasan beserta nama kelas, mapel, dan periode. */
export async function cariKonteksPenugasan(
  db: BasisData,
  penugasanRef: string,
): Promise<KonteksPenugasan | undefined> {
  const [baris] = await db
    .select({
      id: penugasan.id,
      kelasRef: penugasan.kelasRef,
      kelasNama: kelas.nama,
      mapelNama: mapel.nama,
      kkm: mapel.kkm,
      periodeRef: kelas.periodeRef,
      guruRef: penugasan.guruRef,
    })
    .from(penugasan)
    .innerJoin(kelas, eq(kelas.id, penugasan.kelasRef))
    .innerJoin(mapel, eq(mapel.id, penugasan.mapelRef))
    .where(eq(penugasan.id, penugasanRef))
    .limit(1);
  return baris ? Object.freeze({ ...baris }) : undefined;
}

/** Seluruh komponen snapshot penugasan, terurut tampilan. */
export async function daftarKomponenSnapshot(
  db: BasisData,
  penugasanRef: string,
): Promise<readonly KomponenSnapshot[]> {
  const baris = await db
    .select({
      id: komponenPenilaian.id,
      kode: komponenPenilaian.kode,
      nama: komponenPenilaian.nama,
      bobot: komponenPenilaian.bobot,
      urutan: komponenPenilaian.urutan,
      topik: penugasanKomponen.topik,
    })
    .from(penugasanKomponen)
    .innerJoin(komponenPenilaian, eq(komponenPenilaian.id, penugasanKomponen.komponenRef))
    .where(eq(penugasanKomponen.penugasanRef, penugasanRef))
    .orderBy(asc(komponenPenilaian.urutan), asc(komponenPenilaian.id));
  return Object.freeze(baris.map((b) => Object.freeze({ ...b })));
}

/** Seluruh siswa anggota kelas, terurut nama — SCHEMA.md §8.1. */
export async function daftarSiswaKelas(
  db: BasisData,
  kelasRef: string,
): Promise<readonly SiswaKelas[]> {
  const baris = await db
    .select({ siswaRef: kelasSiswa.siswaRef, nama: pengguna.nama })
    .from(kelasSiswa)
    .innerJoin(siswa, eq(siswa.penggunaRef, kelasSiswa.siswaRef))
    .innerJoin(pengguna, eq(pengguna.id, kelasSiswa.siswaRef))
    .where(eq(kelasSiswa.kelasRef, kelasRef))
    .orderBy(asc(pengguna.nama), asc(kelasSiswa.siswaRef));
  return Object.freeze(baris.map((b) => Object.freeze({ ...b })));
}

/** Seluruh baris nilai satu penugasan — bentuk memanjang API.md §6.1. */
export async function daftarBarisNilai(
  db: BasisData,
  penugasanRef: string,
): Promise<readonly BarisNilaiDb[]> {
  const baris = await db
    .select({ siswaRef: nilai.siswaRef, komponenRef: nilai.komponenRef, nilai: nilai.nilai })
    .from(nilai)
    .where(eq(nilai.penugasanRef, penugasanRef));
  return Object.freeze(baris.map((b) => Object.freeze({ ...b, nilai: Number(b.nilai) })));
}

/**
 * Matriks satu penugasan — GET /api/penugasan/:id/nilai.
 * `nilai` memanjang; pasangan yang tidak ada berarti belum diisi (I-12, AC-06).
 */
export async function bacaMatriksNilai(
  db: BasisData,
  penugasanRef: string,
): Promise<HasilNilai<MatriksNilai>> {
  const konteks = await cariKonteksPenugasan(db, penugasanRef);
  if (!konteks) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Penugasan tidak ditemukan." };
  }
  const [komponen, daftarSiswa, baris] = await Promise.all([
    daftarKomponenSnapshot(db, penugasanRef),
    daftarSiswaKelas(db, konteks.kelasRef),
    daftarBarisNilai(db, penugasanRef),
  ]);
  return {
    berhasil: true,
    data: Object.freeze({
      penugasan: Object.freeze({
        id: konteks.id,
        kelasNama: konteks.kelasNama,
        mapelNama: konteks.mapelNama,
        kkm: konteks.kkm,
      }),
      komponen,
      siswa: daftarSiswa,
      nilai: baris,
    }),
  };
}

/**
 * Simpan Nilai — satu transaksi; kegagalan membatalkan seluruh baris.
 *
 * Lapis baris dipanggil lebih dahulu di luar transaksi; pemeriksaan rapor
 * terkunci, keanggotaan siswa, dan snapshot komponen berada di dalam transaksi
 * agar balapan dengan finalisasi tidak dapat menyelundupkan perubahan.
 */
export async function simpanNilai(
  input: MasukanSimpanNilai,
  db: BasisData,
): Promise<HasilNilai<RingkasanSimpanNilai>> {
  const konteks = await cariKonteksPenugasan(db, input.penugasanRef);
  if (!konteks) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Penugasan tidak ditemukan." };
  }

  // Lapis baris: Guru hanya penugasannya sendiri; Administrator tanpa batas.
  if (input.penuntut.peran === "guru" && konteks.guruRef !== input.penuntut.penggunaRef) {
    return {
      berhasil: false,
      jenis: "kewenangan_ditolak",
      pesan: "Anda tidak berwenang atas penugasan ini.",
    };
  }

  // Duplikasi pasangan dalam payload — 400, bukan menunggu 23505.
  const terlihat = new Set<string>();
  for (const satu of input.nilai) {
    const kunci = `${satu.siswaRef}::${satu.komponenRef}`;
    if (terlihat.has(kunci)) {
      return {
        berhasil: false,
        jenis: "permintaan_tidak_sah",
        pesan: "Pasangan siswa dan komponen tidak boleh berulang dalam satu permintaan.",
      };
    }
    terlihat.add(kunci);
  }

  try {
    return await db.transaction(async (tx) => {
      // Rapor kelas pada periode ini — I-22, AC-14. Guru ditolak 409;
      // Administrator dilanjutkan (API.md §6.2). Semua baris, termasuk yang
      // masih draft, dikunci agar finalisasi terserialisasi sesudah COMMIT.
      const barisRapor = await tx
        .select({ id: rapor.id, status: rapor.status })
        .from(rapor)
        .where(
          sql`${rapor.kelasRef} = ${konteks.kelasRef}
            AND ${rapor.periodeRef} = ${konteks.periodeRef}`,
        )
        .for("update");
      const raporTerkunci = barisRapor.some(
        (item) => item.status === "finalized" || item.status === "distributed",
      );
      if (raporTerkunci && input.penuntut.peran === "guru") {
        return {
          berhasil: false,
          jenis: "rapor_terkunci",
          pesan: "Rapor sudah final. Perubahan nilai hanya dapat dilakukan Administrator.",
        };
      }

      // Seluruh siswa_ref wajib anggota kelas — SCHEMA.md §11, S-01.
      const siswaKelas = await tx
        .select({ siswaRef: kelasSiswa.siswaRef })
        .from(kelasSiswa)
        .where(eq(kelasSiswa.kelasRef, konteks.kelasRef));
      const himpunanSiswa = new Set(siswaKelas.map((s) => s.siswaRef));
      const siswaAsing = input.nilai.find((s) => !himpunanSiswa.has(s.siswaRef));
      if (siswaAsing) {
        return {
          berhasil: false,
          jenis: "siswa_asing",
          pesan: "Daftar nilai memuat siswa yang bukan anggota kelas penugasan.",
        };
      }

      // Seluruh komponen_ref wajib snapshot penugasan — CK-API-15.
      const komponenSnapshot = await tx
        .select({ komponenRef: penugasanKomponen.komponenRef })
        .from(penugasanKomponen)
        .where(eq(penugasanKomponen.penugasanRef, input.penugasanRef));
      const himpunanKomponen = new Set(komponenSnapshot.map((k) => k.komponenRef));
      const komponenAsing =
        input.nilai.find((n) => !himpunanKomponen.has(n.komponenRef)) ??
        input.topik.find((t) => !himpunanKomponen.has(t.komponenRef));
      if (komponenAsing) {
        return {
          berhasil: false,
          jenis: "komponen_asing",
          pesan: "Daftar nilai memuat komponen yang bukan snapshot penugasan.",
        };
      }

      let tersimpan = 0;
      let terhapus = 0;
      for (const satu of input.nilai) {
        if (satu.nilai === null) {
          const dihapus = await tx
            .delete(nilai)
            .where(
              sql`${nilai.penugasanRef} = ${input.penugasanRef}
                AND ${nilai.komponenRef} = ${satu.komponenRef}
                AND ${nilai.siswaRef} = ${satu.siswaRef}`,
            )
            .returning({ id: nilai.id });
          terhapus += dihapus.length;
        } else {
          await tx
            .insert(nilai)
            .values({
              penugasanRef: input.penugasanRef,
              komponenRef: satu.komponenRef,
              siswaRef: satu.siswaRef,
              nilai: satu.nilai.toFixed(2),
              diperbaruiOleh: input.penuntut.penggunaRef,
            })
            .onConflictDoUpdate({
              target: [nilai.penugasanRef, nilai.komponenRef, nilai.siswaRef],
              set: {
                nilai: satu.nilai.toFixed(2),
                diperbaruiOleh: input.penuntut.penggunaRef,
                diperbaruiPada: new Date(),
              },
            });
          tersimpan += 1;
        }
      }

      // Topik menumpang pada transaksi yang sama — CK-API-08.
      for (const satu of input.topik) {
        await tx
          .update(penugasanKomponen)
          .set({ topik: satu.topik })
          .where(
            sql`${penugasanKomponen.penugasanRef} = ${input.penugasanRef}
              AND ${penugasanKomponen.komponenRef} = ${satu.komponenRef}`,
          );
      }

      return {
        berhasil: true,
        data: Object.freeze({ tersimpan, terhapus }),
      };
    });
  } catch (galat) {
    const postgres = galatPostgres(galat);
    // Penyelundupan yang lolos pemeriksaan aplikasi tetap ditolak basis data;
    // nama constraint bawaan dipetakan ke pesan Indonesia — temuan S-07.
    if (postgres?.code === PELANGGARAN_UNIK && postgres.constraint === "uq_nilai") {
      return {
        berhasil: false,
        jenis: "permintaan_tidak_sah",
        pesan: "Nilai untuk pasangan siswa dan komponen tersebut sudah ada.",
      };
    }
    if (postgres?.code === PELANGGARAN_PERIKSA && postgres.constraint === "ck_nilai_rentang") {
      return {
        berhasil: false,
        jenis: "permintaan_tidak_sah",
        pesan: "Nilai wajib berada pada rentang 0 sampai 100.",
      };
    }
    if (postgres?.code === PELANGGARAN_KUNCI_ASING) {
      return {
        berhasil: false,
        jenis: "permintaan_tidak_sah",
        pesan: "Data yang dirujuk tidak sah.",
      };
    }
    throw galat;
  }
}

/** Satu komponen pada bentuk siswa — API.md §9. `nilai` null berarti belum
 *  diisi (I-12), dan frontend tidak perlu membedakannya dari nol. */
export type KomponenNilaiSiswa = Readonly<{
  kode: string;
  nama: string;
  bobot: number;
  nilai: number | null;
  topik: string | null;
}>;

/** Satu mata pelajaran pada GET /api/saya/nilai — API.md §9. */
export type NilaiPerMapelSiswa = Readonly<{
  mapel_nama: string;
  kkm: number;
  komponen: readonly KomponenNilaiSiswa[];
  lengkap: boolean;
  nilai_akhir: number | null;
}>;

/**
 * Nilai satu siswa pada satu kelas, seluruh mapel — GET /api/saya/nilai.
 *
 * Bentuknya mengikuti API.md §9 persis: `nilai_akhir` null selama belum
 * lengkap, dan `lengkap` menyatakan sebabnya (AC-06, PRD §8.3). Perhitungan
 * didelegasikan ke `bentukNilaiAkhirSiswa` — tidak ada rumus yang diduplikasi
 * pada lapisan data.
 */
export async function nilaiSiswaPerKelas(
  db: BasisData,
  kelasRef: string,
  siswaRef: string,
): Promise<readonly NilaiPerMapelSiswa[]> {
  const penugasanKelas = await db
    .select({
      id: penugasan.id,
      mapelNama: mapel.nama,
      kkm: mapel.kkm,
    })
    .from(penugasan)
    .innerJoin(mapel, eq(mapel.id, penugasan.mapelRef))
    .where(eq(penugasan.kelasRef, kelasRef))
    .orderBy(asc(mapel.kode), asc(penugasan.id));

  const hasil: NilaiPerMapelSiswa[] = [];
  for (const satu of penugasanKelas) {
    const [komponen, baris] = await Promise.all([
      daftarKomponenSnapshot(db, satu.id),
      db
        .select({ komponenRef: nilai.komponenRef, nilai: nilai.nilai })
        .from(nilai)
        .where(sql`${nilai.penugasanRef} = ${satu.id} AND ${nilai.siswaRef} = ${siswaRef}`),
    ]);
    const barisSiswa: readonly BarisNilaiDb[] = baris.map((b) =>
      Object.freeze({ siswaRef, komponenRef: b.komponenRef, nilai: Number(b.nilai) }),
    );
    const akhir = bentukNilaiAkhirSiswa(
      komponen.map((k) => ({ id: k.id, kode: k.kode, bobot: k.bobot })),
      barisSiswa,
      siswaRef,
    );
    const nilaiPerKomponen = new Map(barisSiswa.map((b) => [b.komponenRef, b.nilai]));
    hasil.push(
      Object.freeze({
        mapel_nama: satu.mapelNama,
        kkm: satu.kkm,
        komponen: Object.freeze(
          komponen.map((k) =>
            Object.freeze({
              kode: k.kode,
              nama: k.nama,
              bobot: k.bobot,
              nilai: nilaiPerKomponen.get(k.id) ?? null,
              topik: k.topik,
            }),
          ),
        ),
        lengkap: akhir.lengkap,
        nilai_akhir: akhir.nilaiAkhir,
      }),
    );
  }
  return Object.freeze(hasil);
}

export type BarisKelasNilai = Readonly<{
  siswaRef: string;
  nama: string;
  nilai: Readonly<Record<string, number>>;
  lengkap: boolean;
  nilaiAkhir: number | null;
}>;

/** Matriks nilai sekelas bagi Wali Kelas dan Administrator — GET /api/kelas/:id/nilai. */
export async function nilaiSatuKelas(
  db: BasisData,
  kelasRef: string,
): Promise<
  readonly Readonly<{
    penugasanRef: string;
    mapelNama: string;
    kkm: number;
    komponen: readonly KomponenSnapshot[];
    baris: readonly BarisKelasNilai[];
  }>[]
> {
  const penugasanKelas = await db
    .select({ id: penugasan.id, mapelNama: mapel.nama, kkm: mapel.kkm })
    .from(penugasan)
    .innerJoin(mapel, eq(mapel.id, penugasan.mapelRef))
    .where(eq(penugasan.kelasRef, kelasRef))
    .orderBy(asc(mapel.kode), asc(penugasan.id));

  const daftarSiswa = await daftarSiswaKelas(db, kelasRef);

  const hasil = [];
  for (const satu of penugasanKelas) {
    const [komponen, baris] = await Promise.all([
      daftarKomponenSnapshot(db, satu.id),
      daftarBarisNilai(db, satu.id),
    ]);
    const peta = pivotBarisNilai(baris);
    const komponenDomain = komponen.map((k) => ({ id: k.id, kode: k.kode, bobot: k.bobot }));
    const barisKelas: BarisKelasNilai[] = daftarSiswa.map((s) => {
      const milikSiswa = peta.get(s.siswaRef);
      const nilaiSel: Record<string, number> = {};
      if (milikSiswa) {
        for (const [komponenRef, angka] of milikSiswa) {
          nilaiSel[komponenRef] = angka;
        }
      }
      const barisSiswa = baris.filter((b) => b.siswaRef === s.siswaRef);
      const akhir = bentukNilaiAkhirSiswa(komponenDomain, barisSiswa, s.siswaRef);
      return Object.freeze({
        siswaRef: s.siswaRef,
        nama: s.nama,
        nilai: Object.freeze(nilaiSel),
        lengkap: akhir.lengkap,
        nilaiAkhir: akhir.nilaiAkhir,
      });
    });
    hasil.push(
      Object.freeze({
        penugasanRef: satu.id,
        mapelNama: satu.mapelNama,
        kkm: satu.kkm,
        komponen,
        baris: Object.freeze(barisKelas),
      }),
    );
  }
  return Object.freeze(hasil);
}

/** Nama periode kelas — untuk amplop GET /api/saya/nilai. */
export async function namaPeriodeKelas(
  db: BasisData,
  kelasRef: string,
): Promise<string | undefined> {
  const [baris] = await db
    .select({
      tahunAjaranNama: tahunAjaran.nama,
      semester: periode.semester,
    })
    .from(kelas)
    .innerJoin(periode, eq(periode.id, kelas.periodeRef))
    .innerJoin(tahunAjaran, eq(tahunAjaran.id, periode.tahunAjaranRef))
    .where(eq(kelas.id, kelasRef))
    .limit(1);
  if (!baris) return undefined;
  return `${baris.tahunAjaranNama} ${baris.semester === "ganjil" ? "Ganjil" : "Genap"}`;
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
