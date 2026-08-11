import { asc, eq, inArray, sql } from "drizzle-orm";

import {
  periksaKelengkapanRapor,
  susunRaporMapel,
  type RincianMapelBelumLengkap,
} from "../../domain/rapor.js";
import type { StatusPresensi } from "../../domain/presensi.js";
import type { BasisData } from "../drizzle.js";
import { komponenPenilaian, mapel, penugasan, penugasanKomponen } from "../skema/kurikulum.js";
import { nilai, presensi, sesi } from "../skema/pencatatan.js";
import { rapor, raporMapel } from "../skema/rapor.js";
import {
  cariKonteksKelas,
  daftarKelengkapan,
  keStatus,
  mapelBelumLengkap,
  type Pelaksana,
} from "./kesiapan.js";

/**
 * Finalisasi rapor sekelas — [API.md §8.3] dan [ARCHITECTURE.md Pasal 11].
 *
 * **Satu transaksi**: memeriksa kelengkapan seluruh mata pelajaran (I-20,
 * AC-07), menulis `rapor_mapel` beserta `snapshot_komponen` sebagai salinan
 * beku, lalu mengubah status seluruh rapor kelas menjadi `finalized`.
 *
 * Perenderan berkas **tidak** berada di sini. Ia berjalan sesudah `COMMIT`
 * lewat `db/rapor/berkas.ts`, karena transaksi tidak boleh menggantung selama
 * pekerjaan render dan kegagalan render tidak pernah membatalkan finalisasi.
 */

export type JenisGalatFinalisasi =
  "tidak_ditemukan" | "tanpa_rapor" | "sudah_final" | "mapel_belum_lengkap";

export type HasilFinalisasi =
  | Readonly<{
      berhasil: true;
      data: Readonly<{ difinalisasi: number; difinalisasiPada: Date; raporRef: readonly string[] }>;
    }>
  | Readonly<{
      berhasil: false;
      jenis: JenisGalatFinalisasi;
      pesan: string;
      rincian?: readonly RincianMapelBelumLengkap[];
    }>;

export type MasukanFinalisasi = Readonly<{
  kelasRef: string;
  difinalisasiOleh: string;
  sekarang: () => Date;
}>;

type PenugasanKelas = Readonly<{ id: string; mapelNama: string; kkm: number }>;
type KomponenPenugasan = Readonly<{ kode: string; nama: string; bobot: number }>;

export async function finalisasiKelas(
  db: BasisData,
  masukan: MasukanFinalisasi,
): Promise<HasilFinalisasi> {
  const konteks = await cariKonteksKelas(db, masukan.kelasRef);
  if (!konteks) {
    return { berhasil: false, jenis: "tidak_ditemukan", pesan: "Kelas tidak ditemukan." };
  }

  return db.transaction(async (tx) => {
    // Seluruh baris rapor kelas dikunci lebih dahulu. Simpan Nilai mengunci
    // baris yang sama (db/pencatatan/nilai.ts), sehingga penyimpanan nilai yang
    // berbarengan terserialisasi terhadap finalisasi — bukan menyelinap di
    // antara pemeriksaan kelengkapan dan penulisan salinan beku.
    const barisRapor = await tx
      .select({ id: rapor.id, siswaRef: rapor.siswaRef, status: rapor.status })
      .from(rapor)
      .where(
        sql`${rapor.kelasRef} = ${masukan.kelasRef} AND ${rapor.periodeRef} = ${konteks.periodeRef}`,
      )
      .orderBy(asc(rapor.siswaRef))
      .for("update");

    if (barisRapor.length === 0) {
      return {
        berhasil: false as const,
        jenis: "tanpa_rapor" as const,
        pesan:
          "Kelas ini belum memiliki satu pun siswa, sehingga rapornya tidak dapat difinalisasi.",
      };
    }

    const belumDraft = barisRapor.find((satu) => keStatus(satu.status) !== "draft");
    if (belumDraft) {
      return {
        berhasil: false as const,
        jenis: "sudah_final" as const,
        pesan: "Rapor kelas ini sudah difinalisasi dan tidak dapat difinalisasi ulang.",
      };
    }

    const kelengkapan = await daftarKelengkapan(tx, masukan.kelasRef);
    const hasilKelengkapan = periksaKelengkapanRapor(mapelBelumLengkap(kelengkapan));
    if (!hasilKelengkapan.lengkap) {
      return {
        berhasil: false as const,
        jenis: "mapel_belum_lengkap" as const,
        pesan: hasilKelengkapan.pesan,
        rincian: hasilKelengkapan.rincian,
      };
    }

    const daftarPenugasan = await daftarPenugasanKelas(tx, masukan.kelasRef);
    const pengenalPenugasan = daftarPenugasan.map((satu) => satu.id);
    const komponen = await petaKomponen(tx, pengenalPenugasan);
    const nilaiSiswa = await petaNilai(tx, pengenalPenugasan);
    const presensiSiswa = await petaPresensi(tx, pengenalPenugasan);

    const barisMapel = [];
    for (const satuRapor of barisRapor) {
      for (const tugas of daftarPenugasan) {
        const hasil = susunRaporMapel({
          komponen: komponen.get(tugas.id) ?? [],
          nilai: nilaiSiswa.get(kunciPasangan(tugas.id, satuRapor.siswaRef)) ?? [],
          statusPresensi: presensiSiswa.get(kunciPasangan(tugas.id, satuRapor.siswaRef)) ?? [],
        });
        if (!hasil.sah) {
          // Kelengkapan sudah lolos di atas, dan bobot dijaga `trg_komponen_bobot`.
          // Sampai di sini berarti datanya berubah di luar jalur yang diketahui;
          // transaksi dibatalkan alih-alih membekukan angka yang tidak sah.
          throw new Error(
            `Rapor mata pelajaran ${tugas.mapelNama} tidak dapat dibekukan: ${hasil.sebab}`,
          );
        }
        barisMapel.push({
          raporRef: satuRapor.id,
          mapelNama: tugas.mapelNama,
          kkm: tugas.kkm,
          nilaiAkhir: hasil.baris.nilaiAkhir.toFixed(2),
          kehadiranPersen: hasil.baris.kehadiranPersen.toFixed(2),
          snapshotKomponen: hasil.baris.snapshotKomponen,
        });
      }
    }

    if (barisMapel.length > 0) {
      await tx.insert(raporMapel).values(barisMapel);
    }

    const difinalisasiPada = masukan.sekarang();
    await tx
      .update(rapor)
      .set({
        status: "finalized",
        difinalisasiOleh: masukan.difinalisasiOleh,
        difinalisasiPada,
      })
      .where(
        inArray(
          rapor.id,
          barisRapor.map((satu) => satu.id),
        ),
      );

    return {
      berhasil: true as const,
      data: Object.freeze({
        difinalisasi: barisRapor.length,
        difinalisasiPada,
        raporRef: Object.freeze(barisRapor.map((satu) => satu.id)),
      }),
    };
  });
}

/** Seluruh penugasan satu kelas beserta nama mata pelajaran dan KKM-nya. */
export async function daftarPenugasanKelas(
  pelaksana: Pelaksana,
  kelasRef: string,
): Promise<readonly PenugasanKelas[]> {
  const baris = await pelaksana
    .select({ id: penugasan.id, mapelNama: mapel.nama, kkm: mapel.kkm })
    .from(penugasan)
    .innerJoin(mapel, eq(mapel.id, penugasan.mapelRef))
    .where(eq(penugasan.kelasRef, kelasRef))
    .orderBy(asc(mapel.kode), asc(penugasan.id));
  return Object.freeze(baris.map((satu) => Object.freeze({ ...satu })));
}

/** Snapshot komponen per penugasan, terurut tampilan. */
async function petaKomponen(
  pelaksana: Pelaksana,
  pengenalPenugasan: readonly string[],
): Promise<Map<string, KomponenPenugasan[]>> {
  const peta = new Map<string, KomponenPenugasan[]>();
  if (pengenalPenugasan.length === 0) return peta;

  const baris = await pelaksana
    .select({
      penugasanRef: penugasanKomponen.penugasanRef,
      kode: komponenPenilaian.kode,
      nama: komponenPenilaian.nama,
      bobot: komponenPenilaian.bobot,
    })
    .from(penugasanKomponen)
    .innerJoin(komponenPenilaian, eq(komponenPenilaian.id, penugasanKomponen.komponenRef))
    .where(inArray(penugasanKomponen.penugasanRef, [...pengenalPenugasan]))
    .orderBy(asc(komponenPenilaian.urutan), asc(komponenPenilaian.id));

  for (const satu of baris) {
    const daftar = peta.get(satu.penugasanRef) ?? [];
    daftar.push({ kode: satu.kode, nama: satu.nama, bobot: satu.bobot });
    peta.set(satu.penugasanRef, daftar);
  }
  return peta;
}

/** Nilai per pasangan penugasan dan siswa, dikunci dengan kode komponen. */
async function petaNilai(
  pelaksana: Pelaksana,
  pengenalPenugasan: readonly string[],
): Promise<Map<string, { kode: string; nilai: number }[]>> {
  const peta = new Map<string, { kode: string; nilai: number }[]>();
  if (pengenalPenugasan.length === 0) return peta;

  const baris = await pelaksana
    .select({
      penugasanRef: nilai.penugasanRef,
      siswaRef: nilai.siswaRef,
      kode: komponenPenilaian.kode,
      nilai: nilai.nilai,
    })
    .from(nilai)
    .innerJoin(komponenPenilaian, eq(komponenPenilaian.id, nilai.komponenRef))
    .where(inArray(nilai.penugasanRef, [...pengenalPenugasan]));

  for (const satu of baris) {
    const kunci = kunciPasangan(satu.penugasanRef, satu.siswaRef);
    const daftar = peta.get(kunci) ?? [];
    daftar.push({ kode: satu.kode, nilai: Number(satu.nilai) });
    peta.set(kunci, daftar);
  }
  return peta;
}

/**
 * Status presensi per pasangan penugasan dan siswa.
 *
 * Satu baris presensi berarti satu sesi yang dibuka Guru — I-15 menjamin setiap
 * sesi memuat seluruh siswa kelas, sehingga jumlah barisnya adalah penyebut
 * I-18. Perhitungannya sendiri berada di `domain/presensi.ts`.
 */
async function petaPresensi(
  pelaksana: Pelaksana,
  pengenalPenugasan: readonly string[],
): Promise<Map<string, StatusPresensi[]>> {
  const peta = new Map<string, StatusPresensi[]>();
  if (pengenalPenugasan.length === 0) return peta;

  const baris = await pelaksana
    .select({
      penugasanRef: sesi.penugasanRef,
      siswaRef: presensi.siswaRef,
      status: presensi.status,
    })
    .from(presensi)
    .innerJoin(sesi, eq(sesi.id, presensi.sesiRef))
    .where(inArray(sesi.penugasanRef, [...pengenalPenugasan]));

  for (const satu of baris) {
    const kunci = kunciPasangan(satu.penugasanRef, satu.siswaRef);
    const daftar = peta.get(kunci) ?? [];
    daftar.push(satu.status as StatusPresensi);
    peta.set(kunci, daftar);
  }
  return peta;
}

function kunciPasangan(penugasanRef: string, siswaRef: string): string {
  return `${penugasanRef}::${siswaRef}`;
}
