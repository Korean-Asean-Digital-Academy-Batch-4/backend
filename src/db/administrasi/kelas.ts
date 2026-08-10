import { and, asc, countDistinct, desc, eq, inArray, or } from "drizzle-orm";
import { DatabaseError } from "pg";

import type { BasisData } from "../drizzle.js";
import { guru, pengguna, siswa } from "../skema/identitas.js";
import { komponenPenilaian, mapel, penugasan, penugasanKomponen } from "../skema/kurikulum.js";
import { kelas, kelasSiswa, periode, tahunAjaran } from "../skema/periode.js";
import { rapor } from "../skema/rapor.js";
import type { HasilAdministrasi } from "./hasil.js";
import type { Tingkat } from "./mapel.js";

export type SiswaMasukanKelas = Readonly<{
  baris: number;
  kelas: string;
  nis: string;
  namaBerkas: string;
}>;
export type PembuatanKelas = Readonly<{
  periodeRef: string;
  nama: string;
  tingkat: Tingkat;
  jurusan: string;
  guruRef: readonly string[];
  waliKelasRef: string;
  siswa: readonly SiswaMasukanKelas[];
}>;
export type KelasDibuat = Readonly<{
  id: string;
  nama: string;
  periodeRef: string;
  jumlahSiswa: number;
  jumlahPenugasan: number;
}>;
export type RingkasanKelas = Readonly<{
  id: string;
  nama: string;
  tingkat: Tingkat;
  jurusan: string;
  periode: Readonly<{ id: string; semester: "ganjil" | "genap"; tahunAjaranNama: string }>;
  waliKelas: Readonly<{ id: string; nama: string }>;
  jumlahSiswa: number;
  jumlahPenugasan: number;
}>;
export type DetailKelas = RingkasanKelas &
  Readonly<{
    siswa: readonly Readonly<{ id: string; nama: string; namaPengguna: string }>[];
    penugasan: readonly Readonly<{
      id: string;
      guru: Readonly<{ id: string; nama: string }>;
      mapel: Readonly<{
        id: string;
        kode: string;
        nama: string;
        tingkat: Tingkat;
        kkm: number;
      }>;
    }>[];
  }>;

const PELANGGARAN_UNIK = "23505";

type SiswaTerdaftar = Readonly<{ id: string; nis: string; nama: string }>;
type GuruMapel = Readonly<{
  guruRef: string;
  guruNama: string;
  mapelRef: string | null;
  mapelNama: string | null;
  tingkat: string | null;
}>;

/** Membuat seluruh graf kelas atau tidak menulis apa pun. */
export async function buatKelasAtomik(
  db: BasisData,
  input: PembuatanKelas,
): Promise<HasilAdministrasi<KelasDibuat>> {
  const duplikat = rincianNisGanda(input.siswa);
  if (duplikat.length > 0) return kegagalanBerkas(duplikat);

  try {
    return await db.transaction(async (tx) => {
      const [periodeAda] = await tx
        .select({ id: periode.id })
        .from(periode)
        .where(eq(periode.id, input.periodeRef))
        .limit(1)
        .for("share");
      if (!periodeAda) {
        return {
          berhasil: false,
          jenis: "tidak_ditemukan",
          pesan: "Periode sasaran tidak ditemukan.",
        };
      }

      // Duplikat kelas berpreseden atas konflik anggota dari kelas yang sama.
      // Tanpa pemeriksaan ini, pengulangan request yang identik tampak seperti
      // kegagalan XLSX karena seluruh siswa sudah dimasukkan request pertama.
      const [kelasSudahAda] = await tx
        .select({ nama: kelas.nama, waliKelasRef: kelas.waliKelasRef })
        .from(kelas)
        .where(
          and(
            eq(kelas.periodeRef, input.periodeRef),
            or(eq(kelas.nama, input.nama), eq(kelas.waliKelasRef, input.waliKelasRef)),
          ),
        )
        .limit(1);
      if (kelasSudahAda) {
        return {
          berhasil: false,
          jenis: "data_sudah_ada",
          pesan:
            kelasSudahAda.nama === input.nama
              ? "Nama kelas sudah dipakai pada periode sasaran."
              : "Wali kelas sudah ditetapkan pada kelas lain di periode sasaran.",
        };
      }

      const siswaDitemukan = await cariSiswa(tx, input.siswa);
      const tidakDitemukan = input.siswa
        .filter((item) => !siswaDitemukan.has(item.nis))
        .map((item) => rincianSiswa(item, "NIS tidak terdaftar sebagai akun siswa"));
      if (tidakDitemukan.length > 0) return kegagalanBerkas(tidakDitemukan);

      const siswaTerurut = [...siswaDitemukan.values()].sort((a, b) => a.id.localeCompare(b.id));
      await tx
        .select({ id: siswa.penggunaRef })
        .from(siswa)
        .where(
          inArray(
            siswa.penggunaRef,
            siswaTerurut.map((item) => item.id),
          ),
        )
        .orderBy(asc(siswa.penggunaRef))
        .for("update");

      // Permintaan identik dapat sama-sama melewati preflight di atas lalu
      // menunggu kunci siswa yang sama. Setelah memperoleh kunci, baca ulang
      // identitas kelas agar pemenang race dipetakan sebagai duplikat kelas,
      // bukan sebagai konflik I-08 milik anak yang baru saja dibuatnya.
      const [kelasMenangRace] = await tx
        .select({ nama: kelas.nama, waliKelasRef: kelas.waliKelasRef })
        .from(kelas)
        .where(
          and(
            eq(kelas.periodeRef, input.periodeRef),
            or(eq(kelas.nama, input.nama), eq(kelas.waliKelasRef, input.waliKelasRef)),
          ),
        )
        .limit(1);
      if (kelasMenangRace) {
        return {
          berhasil: false,
          jenis: "data_sudah_ada",
          pesan:
            kelasMenangRace.nama === input.nama
              ? "Nama kelas sudah dipakai pada periode sasaran."
              : "Wali kelas sudah ditetapkan pada kelas lain di periode sasaran.",
        };
      }

      const konflik = await rincianKonflikKeanggotaan(
        tx,
        input.periodeRef,
        input.siswa,
        siswaDitemukan,
      );
      if (konflik.length > 0) return kegagalanBerkas(konflik);

      const hasilGuru = await cariGuruMapel(tx, input.guruRef);
      const guruTidakAda = input.guruRef.filter((guruRef) => !hasilGuru.has(guruRef));
      if (guruTidakAda.length > 0) {
        return {
          berhasil: false,
          jenis: "tidak_ditemukan",
          pesan: "Guru tidak ditemukan.",
          rincian: Object.freeze(
            guruTidakAda.map((guruRef) => Object.freeze({ guru_ref: guruRef })),
          ),
        };
      }

      const guruTanpaMapel = input.guruRef
        .map((guruRef) => hasilGuru.get(guruRef)!)
        .filter((item) => !item.mapelRef)
        .map((item) => Object.freeze({ guru_ref: item.guruRef, guru_nama: item.guruNama }));
      if (guruTanpaMapel.length > 0) {
        return {
          berhasil: false,
          jenis: "guru_belum_mengampu",
          pesan: "Setiap Guru yang dipilih wajib sudah mengampu mata pelajaran.",
          rincian: Object.freeze(guruTanpaMapel),
        };
      }

      const jenjangTidakCocok = input.guruRef
        .map((guruRef) => hasilGuru.get(guruRef)!)
        .filter((item) => item.tingkat !== input.tingkat)
        .map((item) =>
          Object.freeze({
            guru_ref: item.guruRef,
            guru_nama: item.guruNama,
            mapel_nama: item.mapelNama,
            jenjang_mapel: item.tingkat,
            jenjang_kelas: input.tingkat,
          }),
        );
      if (jenjangTidakCocok.length > 0) {
        return {
          berhasil: false,
          jenis: "jenjang_tidak_cocok",
          pesan: "Jenjang kelas tidak cocok dengan mata pelajaran Guru yang dipilih.",
          rincian: Object.freeze(jenjangTidakCocok),
        };
      }

      // SHARE mencegah templat diganti di tengah pembuatan snapshot, tetapi tetap
      // mengizinkan beberapa kelas dibuat secara paralel.
      const komponen = await tx
        .select({ id: komponenPenilaian.id })
        .from(komponenPenilaian)
        .orderBy(asc(komponenPenilaian.id))
        .for("share");

      const [kelasBaru] = await tx
        .insert(kelas)
        .values({
          periodeRef: input.periodeRef,
          nama: input.nama,
          tingkat: input.tingkat,
          jurusan: input.jurusan,
          waliKelasRef: input.waliKelasRef,
        })
        .returning({ id: kelas.id });
      if (!kelasBaru) throw new Error("Pembuatan kelas tidak mengembalikan baris.");

      if (siswaTerurut.length > 0) {
        await tx.insert(kelasSiswa).values(
          siswaTerurut.map((item) => ({
            kelasRef: kelasBaru.id,
            siswaRef: item.id,
            periodeRef: input.periodeRef,
          })),
        );
      }

      const penugasanBaru = await tx
        .insert(penugasan)
        .values(
          input.guruRef.map((guruRef) => {
            const item = hasilGuru.get(guruRef)!;
            if (!item.mapelRef) throw new Error("Mapel Guru hilang setelah validasi.");
            return {
              guruRef,
              mapelRef: item.mapelRef,
              kelasRef: kelasBaru.id,
              tingkat: input.tingkat,
            };
          }),
        )
        .returning({ id: penugasan.id });

      const pasanganKomponen = penugasanBaru.flatMap((tugas) =>
        komponen.map((item) => ({ penugasanRef: tugas.id, komponenRef: item.id })),
      );
      if (pasanganKomponen.length > 0) await tx.insert(penugasanKomponen).values(pasanganKomponen);

      if (siswaTerurut.length > 0) {
        await tx.insert(rapor).values(
          siswaTerurut.map((item) => ({
            siswaRef: item.id,
            kelasRef: kelasBaru.id,
            periodeRef: input.periodeRef,
          })),
        );
      }

      return {
        berhasil: true,
        data: Object.freeze({
          id: kelasBaru.id,
          nama: input.nama,
          periodeRef: input.periodeRef,
          jumlahSiswa: siswaTerurut.length,
          jumlahPenugasan: penugasanBaru.length,
        }),
      };
    });
  } catch (galat) {
    const postgres = galatPostgres(galat);
    if (
      postgres?.code === PELANGGARAN_UNIK &&
      (postgres.constraint === "uq_kelas_periode_nama" ||
        postgres.constraint === "uq_kelas_wali_per_periode")
    ) {
      return {
        berhasil: false,
        jenis: "data_sudah_ada",
        pesan: "Kelas atau penetapan wali kelas tersebut sudah ada pada periode sasaran.",
      };
    }
    if (postgres?.code === PELANGGARAN_UNIK && postgres.constraint === "uq_kelas_siswa_periode") {
      const siswaDitemukan = await cariSiswa(db, input.siswa);
      const konflik = await rincianKonflikKeanggotaan(
        db,
        input.periodeRef,
        input.siswa,
        siswaDitemukan,
      );
      return kegagalanBerkas(
        konflik.length > 0
          ? konflik
          : input.siswa.map((item) =>
              rincianSiswa(item, "Sudah terdaftar pada kelas lain pada semester ini"),
            ),
      );
    }
    throw galat;
  }
}

/** Membaca ringkasan seluruh kelas dengan satu kueri agregat. */
export async function daftarKelas(db: BasisData): Promise<readonly RingkasanKelas[]> {
  const hasil = await kueriRingkasan(db)
    .groupBy(
      kelas.id,
      periode.id,
      periode.semester,
      periode.tglMulai,
      tahunAjaran.nama,
      pengguna.id,
      pengguna.nama,
    )
    .orderBy(desc(periode.tglMulai), asc(kelas.nama), asc(kelas.id));
  return Object.freeze(hasil.map(bekukanRingkasan));
}

/** Membaca satu kelas dan kedua koleksi anaknya dengan tiga kueri terikat. */
export async function detailKelas(
  db: BasisData,
  kelasRef: string,
): Promise<HasilAdministrasi<DetailKelas>> {
  const [ringkasan] = await kueriRingkasan(db)
    .where(eq(kelas.id, kelasRef))
    .groupBy(
      kelas.id,
      periode.id,
      periode.semester,
      periode.tglMulai,
      tahunAjaran.nama,
      pengguna.id,
      pengguna.nama,
    )
    .limit(1);
  if (!ringkasan) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Kelas tidak ditemukan." };
  }

  const [anggota, tugas] = await Promise.all([
    db
      .select({ id: pengguna.id, nama: pengguna.nama, namaPengguna: pengguna.namaPengguna })
      .from(kelasSiswa)
      .innerJoin(pengguna, eq(pengguna.id, kelasSiswa.siswaRef))
      .where(eq(kelasSiswa.kelasRef, kelasRef))
      .orderBy(asc(pengguna.nama), asc(pengguna.id)),
    db
      .select({
        id: penugasan.id,
        guruId: pengguna.id,
        guruNama: pengguna.nama,
        mapelId: mapel.id,
        mapelKode: mapel.kode,
        mapelNama: mapel.nama,
        mapelTingkat: mapel.tingkat,
        mapelKkm: mapel.kkm,
      })
      .from(penugasan)
      .innerJoin(mapel, eq(mapel.id, penugasan.mapelRef))
      .innerJoin(pengguna, eq(pengguna.id, penugasan.guruRef))
      .where(eq(penugasan.kelasRef, kelasRef))
      .orderBy(asc(mapel.kode), asc(penugasan.id)),
  ]);

  const dasar = bekukanRingkasan(ringkasan);
  return {
    berhasil: true,
    data: Object.freeze({
      ...dasar,
      siswa: Object.freeze(anggota.map((item) => Object.freeze({ ...item }))),
      penugasan: Object.freeze(
        tugas.map((item) =>
          Object.freeze({
            id: item.id,
            guru: Object.freeze({ id: item.guruId, nama: item.guruNama }),
            mapel: Object.freeze({
              id: item.mapelId,
              kode: item.mapelKode,
              nama: item.mapelNama,
              tingkat: pastikanTingkat(item.mapelTingkat),
              kkm: item.mapelKkm,
            }),
          }),
        ),
      ),
    }),
  };
}

type Pembaca = Pick<BasisData, "select">;

function kueriRingkasan(db: Pembaca) {
  return db
    .select({
      id: kelas.id,
      nama: kelas.nama,
      tingkat: kelas.tingkat,
      jurusan: kelas.jurusan,
      periodeId: periode.id,
      semester: periode.semester,
      tahunAjaranNama: tahunAjaran.nama,
      waliId: pengguna.id,
      waliNama: pengguna.nama,
      jumlahSiswa: countDistinct(kelasSiswa.id),
      jumlahPenugasan: countDistinct(penugasan.id),
    })
    .from(kelas)
    .innerJoin(periode, eq(periode.id, kelas.periodeRef))
    .innerJoin(tahunAjaran, eq(tahunAjaran.id, periode.tahunAjaranRef))
    .leftJoin(pengguna, eq(pengguna.id, kelas.waliKelasRef))
    .leftJoin(kelasSiswa, eq(kelasSiswa.kelasRef, kelas.id))
    .leftJoin(penugasan, eq(penugasan.kelasRef, kelas.id));
}

type BarisRingkasan = Readonly<{
  id: string;
  nama: string;
  tingkat: string;
  jurusan: string | null;
  periodeId: string;
  semester: string;
  tahunAjaranNama: string;
  waliId: string | null;
  waliNama: string | null;
  jumlahSiswa: number;
  jumlahPenugasan: number;
}>;

function bekukanRingkasan(item: BarisRingkasan): RingkasanKelas {
  return Object.freeze({
    id: item.id,
    nama: item.nama,
    tingkat: pastikanTingkat(item.tingkat),
    // Baris lama sebelum kontrak A5 boleh memiliki kedua kolom opsional ini.
    jurusan: item.jurusan ?? "",
    periode: Object.freeze({
      id: item.periodeId,
      semester: pastikanSemester(item.semester),
      tahunAjaranNama: item.tahunAjaranNama,
    }),
    waliKelas: Object.freeze({ id: item.waliId ?? "", nama: item.waliNama ?? "" }),
    jumlahSiswa: item.jumlahSiswa,
    jumlahPenugasan: item.jumlahPenugasan,
  });
}

async function cariSiswa(
  db: Pembaca,
  input: readonly SiswaMasukanKelas[],
): Promise<ReadonlyMap<string, SiswaTerdaftar>> {
  const nis = Object.freeze([...new Set(input.map((item) => item.nis))]);
  if (nis.length === 0) return new Map();
  const hasil = await db
    .select({ id: siswa.penggunaRef, nis: pengguna.namaPengguna, nama: pengguna.nama })
    .from(siswa)
    .innerJoin(pengguna, eq(pengguna.id, siswa.penggunaRef))
    .where(inArray(pengguna.namaPengguna, nis));
  return new Map(hasil.map((item) => [item.nis, Object.freeze(item)]));
}

async function cariGuruMapel(
  db: Pembaca,
  guruRef: readonly string[],
): Promise<ReadonlyMap<string, GuruMapel>> {
  if (guruRef.length === 0) return new Map();
  const hasil = await db
    .select({
      guruRef: guru.penggunaRef,
      guruNama: pengguna.nama,
      mapelRef: mapel.id,
      mapelNama: mapel.nama,
      tingkat: mapel.tingkat,
    })
    .from(guru)
    .innerJoin(pengguna, eq(pengguna.id, guru.penggunaRef))
    .leftJoin(mapel, eq(mapel.guruRef, guru.penggunaRef))
    .where(inArray(guru.penggunaRef, [...guruRef]));
  return new Map(hasil.map((item) => [item.guruRef, Object.freeze(item)]));
}

async function rincianKonflikKeanggotaan(
  db: Pembaca,
  periodeRef: string,
  input: readonly SiswaMasukanKelas[],
  ditemukan: ReadonlyMap<string, SiswaTerdaftar>,
): Promise<readonly unknown[]> {
  const siswaRef = [...ditemukan.values()].map((item) => item.id);
  if (siswaRef.length === 0) return Object.freeze([]);
  const hasil = await db
    .select({ siswaRef: kelasSiswa.siswaRef, kelasNama: kelas.nama })
    .from(kelasSiswa)
    .innerJoin(kelas, eq(kelas.id, kelasSiswa.kelasRef))
    .where(and(eq(kelasSiswa.periodeRef, periodeRef), inArray(kelasSiswa.siswaRef, siswaRef)));
  const namaKelas = new Map(hasil.map((item) => [item.siswaRef, item.kelasNama]));
  return Object.freeze(
    input.flatMap((item) => {
      const siswaAda = ditemukan.get(item.nis);
      const kelasAda = siswaAda ? namaKelas.get(siswaAda.id) : undefined;
      return kelasAda
        ? [rincianSiswa(item, `Sudah terdaftar pada kelas ${kelasAda} pada semester ini`)]
        : [];
    }),
  );
}

function rincianNisGanda(input: readonly SiswaMasukanKelas[]): readonly unknown[] {
  const dilihat = new Set<string>();
  return Object.freeze(
    input.flatMap((item) => {
      if (dilihat.has(item.nis)) return [rincianSiswa(item, "NIS ganda di dalam berkas")];
      dilihat.add(item.nis);
      return [];
    }),
  );
}

function rincianSiswa(item: SiswaMasukanKelas, sebab: string): Readonly<Record<string, unknown>> {
  return Object.freeze({ baris: item.baris, nis: item.nis, sebab });
}

function kegagalanBerkas(rincian: readonly unknown[]): HasilAdministrasi<never> {
  return {
    berhasil: false,
    jenis: "berkas_tidak_sah",
    pesan: "Daftar siswa mengandung baris yang tidak dapat digunakan.",
    rincian: Object.freeze([...rincian]),
  };
}

function pastikanTingkat(nilai: string): Tingkat {
  if (nilai === "X" || nilai === "XI" || nilai === "XII") return nilai;
  throw new Error("Kelas atau mata pelajaran memiliki tingkat di luar kontrak.");
}

function pastikanSemester(nilai: string): "ganjil" | "genap" {
  if (nilai === "ganjil" || nilai === "genap") return nilai;
  throw new Error("Periode memiliki semester di luar kontrak.");
}

type GalatPostgres = Readonly<{ code?: string; constraint?: string }>;

function galatPostgres(galat: unknown): GalatPostgres | undefined {
  let saatIni = galat;
  const sudahDilihat = new Set<unknown>();
  while (typeof saatIni === "object" && saatIni !== null && !sudahDilihat.has(saatIni)) {
    sudahDilihat.add(saatIni);
    if (saatIni instanceof DatabaseError) {
      return { code: saatIni.code, constraint: saatIni.constraint };
    }
    saatIni = "cause" in saatIni ? (saatIni as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}
