import { asc, eq, sql } from "drizzle-orm";

import type { BasisData } from "../drizzle.js";
import { hitungPersentaseKehadiran, type StatusPresensi } from "../../domain/presensi.js";
import { pengguna, siswa } from "../skema/identitas.js";
import { mapel, penugasan } from "../skema/kurikulum.js";
import { presensi, sesi } from "../skema/pencatatan.js";
import { kelas, kelasSiswa, periode, tahunAjaran } from "../skema/periode.js";
import { rapor } from "../skema/rapor.js";

/**
 * Lapisan data presensi — API.md §7.
 *
 * Sesi beserta seluruh presensinya terbentuk dalam satu transaksi (CK-API-11);
 * daftar siswa diturunkan server dari `kelas_siswa`, bukan dari payload, dan
 * yang tidak disebut tetap tersimpan `alpa` — I-15, AC-11.
 */

const PELANGGARAN_UNIK = "23505";

export type JenisGalatPresensi =
  | "tidak_ditemukan"
  | "kewenangan_ditolak"
  | "sesi_sudah_ada"
  | "rapor_terkunci"
  | "siswa_asing"
  | "permintaan_tidak_sah";

export type HasilPresensi<T> =
  | Readonly<{ berhasil: true; data: T }>
  | Readonly<{ berhasil: false; jenis: JenisGalatPresensi; pesan: string }>;

export type SesiRingkas = Readonly<{
  id: string;
  tanggal: string;
  ringkasan: Readonly<{ hadir: number; izin: number; sakit: number; alpa: number }>;
}>;

export type PresensiSiswa = Readonly<{
  siswa_ref: string;
  nama: string;
  status: StatusPresensi;
  catatan: string | null;
}>;

export type SesiLengkap = Readonly<{
  id: string;
  penugasan_ref: string;
  tanggal: string;
  presensi: readonly PresensiSiswa[];
}>;

export type RingkasanPresensiSiswa = Readonly<{
  siswa_ref: string;
  nama: string;
  per_mapel: readonly Readonly<{
    mapel_nama: string;
    ada_sesi: boolean;
    persen: number | null;
  }>[];
}>;

/** Konteks penugasan untuk izin dan rapor terkunci. */
export async function cariKonteksPenugasanPresensi(
  db: BasisData,
  penugasanRef: string,
): Promise<
  Readonly<{ id: string; kelasRef: string; guruRef: string; periodeRef: string }> | undefined
> {
  const [baris] = await db
    .select({
      id: penugasan.id,
      kelasRef: penugasan.kelasRef,
      guruRef: penugasan.guruRef,
      periodeRef: kelas.periodeRef,
    })
    .from(penugasan)
    .innerJoin(kelas, eq(kelas.id, penugasan.kelasRef))
    .where(eq(penugasan.id, penugasanRef))
    .limit(1);
  return baris ? Object.freeze({ ...baris }) : undefined;
}

/** Daftar siswa kelas — server yang menurunkan, bukan payload (I-15, AC-11). */
export async function daftarSiswaKelasPresensi(
  db: BasisData,
  kelasRef: string,
): Promise<readonly Readonly<{ siswa_ref: string; nama: string }>[]> {
  const baris = await db
    .select({ siswaRef: kelasSiswa.siswaRef, nama: pengguna.nama })
    .from(kelasSiswa)
    .innerJoin(siswa, eq(siswa.penggunaRef, kelasSiswa.siswaRef))
    .innerJoin(pengguna, eq(pengguna.id, kelasSiswa.siswaRef))
    .where(eq(kelasSiswa.kelasRef, kelasRef))
    .orderBy(asc(pengguna.nama), asc(kelasSiswa.siswaRef));
  return Object.freeze(baris.map((b) => Object.freeze({ siswa_ref: b.siswaRef, nama: b.nama })));
}

/** Daftar sesi satu penugasan beserta ringkasan per status — API.md §7.4. */
export async function daftarSesiPenugasan(
  db: BasisData,
  penugasanRef: string,
): Promise<readonly SesiRingkas[]> {
  const baris = await db
    .select({
      id: sesi.id,
      // Kolom date dibaca sebagai teks YYYY-MM-DD persis seperti disimpan —
      // bukan Date JS yang terserialisasi ISO berzona (API.md §7.2).
      tanggal: sql<string>`${sesi.tanggal}::text`,
      hadir: sql<number>`count(*) filter (where ${presensi.status} = 'hadir')`,
      izin: sql<number>`count(*) filter (where ${presensi.status} = 'izin')`,
      sakit: sql<number>`count(*) filter (where ${presensi.status} = 'sakit')`,
      alpa: sql<number>`count(*) filter (where ${presensi.status} = 'alpa')`,
    })
    .from(sesi)
    .leftJoin(presensi, eq(presensi.sesiRef, sesi.id))
    .where(eq(sesi.penugasanRef, penugasanRef))
    .groupBy(sesi.id)
    .orderBy(asc(sesi.tanggal), asc(sesi.id));
  return Object.freeze(
    baris.map((b) =>
      Object.freeze({
        id: b.id,
        tanggal: b.tanggal,
        ringkasan: Object.freeze({
          hadir: Number(b.hadir),
          izin: Number(b.izin),
          sakit: Number(b.sakit),
          alpa: Number(b.alpa),
        }),
      }),
    ),
  );
}

/** Satu sesi beserta seluruh status siswanya — API.md §7.4. */
export async function bacaSesi(db: BasisData, sesiRef: string): Promise<SesiLengkap | undefined> {
  const [kepala] = await db
    .select({
      id: sesi.id,
      penugasanRef: sesi.penugasanRef,
      tanggal: sql<string>`${sesi.tanggal}::text`,
    })
    .from(sesi)
    .where(eq(sesi.id, sesiRef))
    .limit(1);
  if (!kepala) return undefined;
  const baris = await db
    .select({
      siswaRef: presensi.siswaRef,
      nama: pengguna.nama,
      status: presensi.status,
      catatan: presensi.catatan,
    })
    .from(presensi)
    .innerJoin(siswa, eq(siswa.penggunaRef, presensi.siswaRef))
    .innerJoin(pengguna, eq(pengguna.id, presensi.siswaRef))
    .where(eq(presensi.sesiRef, sesiRef))
    .orderBy(asc(pengguna.nama), asc(presensi.siswaRef));
  return Object.freeze({
    id: kepala.id,
    penugasan_ref: kepala.penugasanRef,
    tanggal: kepala.tanggal,
    presensi: Object.freeze(
      baris.map((b) =>
        Object.freeze({
          siswa_ref: b.siswaRef,
          nama: b.nama,
          status: b.status as StatusPresensi,
          catatan: b.catatan,
        }),
      ),
    ),
  });
}

export type MasukanBuatSesi = Readonly<{
  penugasanRef: string;
  penuntut: Readonly<{ penggunaRef: string; peran: string }>;
  tanggal: string;
  presensi: readonly Readonly<{
    siswaRef: string;
    status: StatusPresensi;
    catatan: string | null;
  }>[];
}>;

/**
 * POST sesi — satu transaksi (CK-API-11). Baris `sesi` dan seluruh `presensi`
 * terbentuk bersamaan; siswa yang tidak disebut tetap disisipkan `alpa`.
 * Sesi kedua pada penugasan-tanggal sama ditolak `SESI_SUDAH_ADA` — I-14, P6.
 */
export async function buatSesi(
  input: MasukanBuatSesi,
  db: BasisData,
): Promise<
  HasilPresensi<Readonly<{ sesi: Readonly<{ id: string; tanggal: string }>; tersimpan: number }>>
> {
  const konteks = await cariKonteksPenugasanPresensi(db, input.penugasanRef);
  if (!konteks) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Penugasan tidak ditemukan." };
  }
  if (input.penuntut.peran === "guru" && konteks.guruRef !== input.penuntut.penggunaRef) {
    return {
      berhasil: false,
      jenis: "kewenangan_ditolak",
      pesan: "Anda tidak berwenang atas penugasan ini.",
    };
  }

  try {
    return await db.transaction(async (tx) => {
      // I-22: Guru ditolak apabila rapor kelas sudah final; Administrator lanjut.
      const [raporTerkunci] = await tx
        .select({ id: rapor.id })
        .from(rapor)
        .where(
          sql`${rapor.kelasRef} = ${konteks.kelasRef}
            AND ${rapor.periodeRef} = ${konteks.periodeRef}
            AND ${rapor.status} IN ('finalized', 'distributed')`,
        )
        .limit(1)
        .for("share");
      if (raporTerkunci && input.penuntut.peran === "guru") {
        return {
          berhasil: false,
          jenis: "rapor_terkunci",
          pesan: "Rapor sudah final. Perubahan presensi hanya dapat dilakukan Administrator.",
        };
      }

      // Daftar siswa diturunkan server — SCHEMA.md §11. Siswa asing ditolak.
      const anggota = await tx
        .select({ siswaRef: kelasSiswa.siswaRef })
        .from(kelasSiswa)
        .where(eq(kelasSiswa.kelasRef, konteks.kelasRef));
      const himpunan = new Set(anggota.map((a) => a.siswaRef));
      const asing = input.presensi.find((p) => !himpunan.has(p.siswaRef));
      if (asing) {
        return {
          berhasil: false,
          jenis: "siswa_asing",
          pesan: "Daftar presensi memuat siswa yang bukan anggota kelas penugasan.",
        };
      }
      const terlihat = new Set<string>();
      for (const satu of input.presensi) {
        if (terlihat.has(satu.siswaRef)) {
          return {
            berhasil: false,
            jenis: "permintaan_tidak_sah",
            pesan: "Siswa tidak boleh muncul lebih dari sekali dalam satu permintaan.",
          };
        }
        terlihat.add(satu.siswaRef);
      }

      const [baris] = await tx
        .insert(sesi)
        .values({
          penugasanRef: input.penugasanRef,
          tanggal: input.tanggal,
          dibukaOleh: input.penuntut.penggunaRef,
        })
        .returning({ id: sesi.id, tanggal: sql<string>`${sesi.tanggal}::text` });
      if (!baris) throw new Error("Pembuatan sesi tidak mengembalikan baris.");

      const statusPerSiswa = new Map(input.presensi.map((p) => [p.siswaRef, p]));
      const nilaiPresensi = anggota.map((a) => {
        const dipilih = statusPerSiswa.get(a.siswaRef);
        return {
          sesiRef: baris.id,
          siswaRef: a.siswaRef,
          status: dipilih?.status ?? "alpa",
          catatan: dipilih?.catatan ?? null,
          diperbaruiOleh: input.penuntut.penggunaRef,
        };
      });
      if (nilaiPresensi.length > 0) {
        await tx.insert(presensi).values(nilaiPresensi);
      }

      return {
        berhasil: true,
        data: Object.freeze({
          sesi: Object.freeze({ id: baris.id, tanggal: baris.tanggal }),
          tersimpan: nilaiPresensi.length,
        }),
      };
    });
  } catch (galat) {
    const postgres = galatPostgres(galat);
    if (
      postgres?.code === PELANGGARAN_UNIK &&
      postgres.constraint === "uq_sesi_penugasan_tanggal"
    ) {
      return {
        berhasil: false,
        jenis: "sesi_sudah_ada",
        pesan: "Sesi untuk penugasan dan tanggal ini sudah ada.",
      };
    }
    throw galat;
  }
}

export type MasukanUbahSesi = Readonly<{
  sesiRef: string;
  penuntut: Readonly<{ penggunaRef: string; peran: string }>;
  presensi: readonly Readonly<{
    siswaRef: string;
    status: StatusPresensi;
    catatan: string | null;
  }>[];
}>;

/**
 * PUT seluruh daftar presensi satu sesi — hanya memperbarui; keanggotaan sesi
 * tidak pernah berubah (API.md §7.3). Tanpa pencatatan riwayat — P7.
 */
export async function ubahPresensiSesi(
  input: MasukanUbahSesi,
  db: BasisData,
): Promise<HasilPresensi<Readonly<{ diperbarui: number }>>> {
  const [kepala] = await db
    .select({ id: sesi.id, penugasanRef: sesi.penugasanRef })
    .from(sesi)
    .where(eq(sesi.id, input.sesiRef))
    .limit(1);
  if (!kepala) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Sesi tidak ditemukan." };
  }
  const konteks = await cariKonteksPenugasanPresensi(db, kepala.penugasanRef);
  if (!konteks) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Penugasan tidak ditemukan." };
  }
  if (input.penuntut.peran === "guru" && konteks.guruRef !== input.penuntut.penggunaRef) {
    return {
      berhasil: false,
      jenis: "kewenangan_ditolak",
      pesan: "Anda tidak berwenang atas sesi ini.",
    };
  }

  return db.transaction(async (tx) => {
    const [raporTerkunci] = await tx
      .select({ id: rapor.id })
      .from(rapor)
      .where(
        sql`${rapor.kelasRef} = ${konteks.kelasRef}
          AND ${rapor.periodeRef} = ${konteks.periodeRef}
          AND ${rapor.status} IN ('finalized', 'distributed')`,
      )
      .limit(1)
      .for("share");
    if (raporTerkunci && input.penuntut.peran === "guru") {
      return {
        berhasil: false,
        jenis: "rapor_terkunci",
        pesan: "Rapor sudah final. Perubahan presensi hanya dapat dilakukan Administrator.",
      };
    }

    // Keanggotaan sesi dibaca dari basis data; payload hanya boleh menyebutnya.
    const anggota = await tx
      .select({ siswaRef: presensi.siswaRef })
      .from(presensi)
      .where(eq(presensi.sesiRef, input.sesiRef));
    const himpunan = new Set(anggota.map((a) => a.siswaRef));
    const asing = input.presensi.find((p) => !himpunan.has(p.siswaRef));
    if (asing) {
      return {
        berhasil: false,
        jenis: "siswa_asing",
        pesan: "Daftar presensi memuat siswa yang bukan anggota sesi ini.",
      };
    }
    const terlihat = new Set<string>();
    for (const satu of input.presensi) {
      if (terlihat.has(satu.siswaRef)) {
        return {
          berhasil: false,
          jenis: "permintaan_tidak_sah",
          pesan: "Siswa tidak boleh muncul lebih dari sekali dalam satu permintaan.",
        };
      }
      terlihat.add(satu.siswaRef);
    }

    let diperbarui = 0;
    for (const satu of input.presensi) {
      const berubah = await tx
        .update(presensi)
        .set({
          status: satu.status,
          catatan: satu.catatan,
          diperbaruiOleh: input.penuntut.penggunaRef,
          diperbaruiPada: new Date(),
        })
        .where(
          sql`${presensi.sesiRef} = ${input.sesiRef} AND ${presensi.siswaRef} = ${satu.siswaRef}`,
        )
        .returning({ id: presensi.id });
      diperbarui += berubah.length;
    }
    return { berhasil: true, data: Object.freeze({ diperbarui }) };
  });
}

/**
 * DELETE sesi — presensi ikut terhapus lewat ON DELETE CASCADE (I-16, AC-25),
 * sehingga persentase kehadiran menyesuaikan sendiri.
 */
export async function hapusSesi(
  sesiRef: string,
  penuntut: Readonly<{ penggunaRef: string; peran: string }>,
  db: BasisData,
): Promise<HasilPresensi<null>> {
  const [kepala] = await db
    .select({ id: sesi.id, penugasanRef: sesi.penugasanRef })
    .from(sesi)
    .where(eq(sesi.id, sesiRef))
    .limit(1);
  if (!kepala) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Sesi tidak ditemukan." };
  }
  const konteks = await cariKonteksPenugasanPresensi(db, kepala.penugasanRef);
  if (!konteks) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Penugasan tidak ditemukan." };
  }
  if (penuntut.peran === "guru" && konteks.guruRef !== penuntut.penggunaRef) {
    return {
      berhasil: false,
      jenis: "kewenangan_ditolak",
      pesan: "Anda tidak berwenang atas sesi ini.",
    };
  }

  return db.transaction(async (tx) => {
    const [raporTerkunci] = await tx
      .select({ id: rapor.id })
      .from(rapor)
      .where(
        sql`${rapor.kelasRef} = ${konteks.kelasRef}
          AND ${rapor.periodeRef} = ${konteks.periodeRef}
          AND ${rapor.status} IN ('finalized', 'distributed')`,
      )
      .limit(1)
      .for("share");
    if (raporTerkunci && penuntut.peran === "guru") {
      return {
        berhasil: false,
        jenis: "rapor_terkunci",
        pesan: "Rapor sudah final. Penghapusan sesi hanya dapat dilakukan Administrator.",
      };
    }
    await tx.delete(sesi).where(eq(sesi.id, sesiRef));
    return { berhasil: true, data: null };
  });
}

/** Persentase kehadiran satu siswa per mapel — I-17, I-18; AC-29, AC-30. */
export async function presensiSiswaPerKelas(
  db: BasisData,
  kelasRef: string,
  siswaRef: string,
): Promise<
  readonly Readonly<{ mapel_nama: string; ada_sesi: boolean; persen: number | null }>[]
> {
  const penugasanKelas = await db
    .select({ id: penugasan.id, mapelNama: mapel.nama })
    .from(penugasan)
    .innerJoin(mapel, eq(mapel.id, penugasan.mapelRef))
    .where(eq(penugasan.kelasRef, kelasRef))
    .orderBy(asc(mapel.kode), asc(penugasan.id));

  const hasil = [];
  for (const satu of penugasanKelas) {
    const baris = await db
      .select({ status: presensi.status })
      .from(presensi)
      .innerJoin(sesi, eq(sesi.id, presensi.sesiRef))
      .where(sql`${sesi.penugasanRef} = ${satu.id} AND ${presensi.siswaRef} = ${siswaRef}`);
    const kehadiran = hitungPersentaseKehadiran(baris.map((b) => b.status as StatusPresensi));
    hasil.push(
      Object.freeze(
        kehadiran.adaSesi
          ? { mapel_nama: satu.mapelNama, ada_sesi: true, persen: kehadiran.persen }
          : { mapel_nama: satu.mapelNama, ada_sesi: false, persen: null },
      ),
    );
  }
  return Object.freeze(hasil);
}

/** Ringkasan seluruh siswa satu kelas per mapel — GET /api/kelas/:id/presensi. */
export async function presensiSatuKelas(
  db: BasisData,
  kelasRef: string,
): Promise<readonly RingkasanPresensiSiswa[]> {
  const anggota = await daftarSiswaKelasPresensi(db, kelasRef);
  const hasil: RingkasanPresensiSiswa[] = [];
  for (const satu of anggota) {
    const perMapel = await presensiSiswaPerKelas(db, kelasRef, satu.siswa_ref);
    hasil.push(Object.freeze({ siswa_ref: satu.siswa_ref, nama: satu.nama, per_mapel: perMapel }));
  }
  return Object.freeze(hasil);
}

/** Nama periode kelas — amplop GET /api/saya/presensi. */
export async function namaPeriodeKelasPresensi(
  db: BasisData,
  kelasRef: string,
): Promise<string | undefined> {
  const [baris] = await db
    .select({ tahunAjaranNama: tahunAjaran.nama, semester: periode.semester })
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
