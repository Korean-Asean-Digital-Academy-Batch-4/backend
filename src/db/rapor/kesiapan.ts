import { asc, eq, sql } from "drizzle-orm";

import { STATUS_RAPOR, type StatusRapor } from "../../domain/rapor.js";
import type { BasisData } from "../drizzle.js";
import { pengguna } from "../skema/identitas.js";
import { kelas, periode, tahunAjaran } from "../skema/periode.js";
import { rapor } from "../skema/rapor.js";

/**
 * Kesiapan rapor satu kelas — [API.md §8.1].
 *
 * Layar Wali Kelas (UC-11). **Di luar momen finalisasi tidak ada pemberitahuan
 * kelengkapan dalam bentuk apa pun** ([PRD §6.3]): berkas ini dibaca ketika Wali
 * Kelas membuka layarnya sendiri, dan tidak pernah mendorong apa pun ke Guru.
 */

/** Executor Drizzle, baik pool maupun transaksi. */
export type Pelaksana = BasisData | Parameters<Parameters<BasisData["transaction"]>[0]>[0];

export type KonteksKelas = Readonly<{
  id: string;
  nama: string;
  tingkat: string;
  periodeRef: string;
  periodeNama: string;
  waliKelasRef: string | null;
  waliKelasNama: string | null;
}>;

export type KelengkapanMapel = Readonly<{
  mapelNama: string;
  lengkap: boolean;
  nilaiTerisi: number;
  nilaiDiperlukan: number;
}>;

export type RaporKelas = Readonly<{
  id: string;
  siswaRef: string;
  siswaNama: string;
  catatanWali: string | null;
  status: StatusRapor;
}>;

export type KesiapanKelas = Readonly<{
  konteks: KonteksKelas;
  status: StatusRapor;
  kelengkapan: readonly KelengkapanMapel[];
  rapor: readonly RaporKelas[];
}>;

/** Konteks satu kelas beserta nama periode dan wali kelasnya. */
export async function cariKonteksKelas(
  pelaksana: Pelaksana,
  kelasRef: string,
): Promise<KonteksKelas | undefined> {
  const [baris] = await pelaksana
    .select({
      id: kelas.id,
      nama: kelas.nama,
      tingkat: kelas.tingkat,
      periodeRef: kelas.periodeRef,
      tahunAjaranNama: tahunAjaran.nama,
      semester: periode.semester,
      waliKelasRef: kelas.waliKelasRef,
      waliKelasNama: pengguna.nama,
    })
    .from(kelas)
    .innerJoin(periode, eq(periode.id, kelas.periodeRef))
    .innerJoin(tahunAjaran, eq(tahunAjaran.id, periode.tahunAjaranRef))
    .leftJoin(pengguna, eq(pengguna.id, kelas.waliKelasRef))
    .where(eq(kelas.id, kelasRef))
    .limit(1);

  if (!baris) return undefined;

  return Object.freeze({
    id: baris.id,
    nama: baris.nama,
    tingkat: baris.tingkat,
    periodeRef: baris.periodeRef,
    periodeNama: `${baris.tahunAjaranNama} ${baris.semester === "ganjil" ? "Ganjil" : "Genap"}`,
    waliKelasRef: baris.waliKelasRef,
    waliKelasNama: baris.waliKelasNama,
  });
}

/**
 * Kelengkapan nilai per mata pelajaran — penegakan I-20 dan penghasil AC-07.
 *
 * Bentuknya mengikuti [SCHEMA.md §8.2] dengan dua perbedaan yang disengaja.
 * Pertama, ia menghitung jumlah sel terisi dan sel diperlukan, karena
 * [API.md §8.1] memang menampilkan keduanya; kueri SCHEMA hanya mengembalikan
 * nama yang belum lengkap, yaitu baris dengan `nilaiTerisi < nilaiDiperlukan` di
 * sini. Kedua, penyebutnya diambil dari `penugasan_komponen` — snapshot komponen
 * penugasan yang bersangkutan (CK-API-15) — bukan dari seluruh
 * `komponen_penilaian`. Keduanya bernilai sama hari ini karena A5 menyalin
 * seluruh templat ke setiap penugasan yang dibuatnya; yang menjadi berbeda hanya
 * apabila kelak satu penugasan memakai sebagian komponen saja, dan pada keadaan
 * itu snapshot-lah penyebut yang benar: nilai di luar snapshot memang tidak
 * dapat diisi siapa pun.
 *
 * `I-12` terpakai apa adanya: baris `nilai` hanya ada bila terisi, sehingga
 * "belum lengkap" cukup dinyatakan sebagai ketiadaan baris.
 */
export async function daftarKelengkapan(
  pelaksana: Pelaksana,
  kelasRef: string,
): Promise<readonly KelengkapanMapel[]> {
  const hasil = await pelaksana.execute<{
    mapel_nama: string;
    terisi: number;
    diperlukan: number;
  }>(sql`
    SELECT m.nama                     AS mapel_nama,
           count(n.id)::int           AS terisi,
           count(*)::int              AS diperlukan
    FROM penugasan pg
    JOIN mapel               m  ON m.id = pg.mapel_ref
    JOIN kelas_siswa         ks ON ks.kelas_ref = pg.kelas_ref
    JOIN penugasan_komponen  pk ON pk.penugasan_ref = pg.id
    LEFT JOIN nilai n
           ON n.penugasan_ref = pg.id
          AND n.komponen_ref  = pk.komponen_ref
          AND n.siswa_ref     = ks.siswa_ref
    WHERE pg.kelas_ref = ${kelasRef}
    GROUP BY m.kode, m.nama
    ORDER BY m.kode
  `);

  return Object.freeze(
    hasil.rows.map((baris) =>
      Object.freeze({
        mapelNama: baris.mapel_nama,
        lengkap: baris.terisi >= baris.diperlukan,
        nilaiTerisi: baris.terisi,
        nilaiDiperlukan: baris.diperlukan,
      }),
    ),
  );
}

/** Nama mata pelajaran yang masih belum lengkap, terurut sama seperti tampilan. */
export function mapelBelumLengkap(kelengkapan: readonly KelengkapanMapel[]): readonly string[] {
  return Object.freeze(kelengkapan.filter((satu) => !satu.lengkap).map((satu) => satu.mapelNama));
}

/** Seluruh baris rapor satu kelas, terurut nama siswa. */
export async function daftarRaporKelas(
  pelaksana: Pelaksana,
  kelasRef: string,
  periodeRef: string,
): Promise<readonly RaporKelas[]> {
  const baris = await pelaksana
    .select({
      id: rapor.id,
      siswaRef: rapor.siswaRef,
      siswaNama: pengguna.nama,
      catatanWali: rapor.catatanWali,
      status: rapor.status,
    })
    .from(rapor)
    .innerJoin(pengguna, eq(pengguna.id, rapor.siswaRef))
    .where(sql`${rapor.kelasRef} = ${kelasRef} AND ${rapor.periodeRef} = ${periodeRef}`)
    .orderBy(asc(pengguna.nama), asc(rapor.siswaRef));

  return Object.freeze(
    baris.map((satu) => Object.freeze({ ...satu, status: keStatus(satu.status) })),
  );
}

/**
 * Status kelas: yang **paling belum maju** di antara seluruh rapornya.
 *
 * Finalisasi dan distribusi bersifat sekelas dan satu transaksi, sehingga
 * seluruh baris seharusnya seragam. Mengambil yang paling belakang membuat
 * keadaan tidak seragam — bila kelak muncul karena koreksi Administrator —
 * terbaca sebagai belum selesai, bukan sebagai sudah selesai.
 */
export function statusKelas(daftar: readonly RaporKelas[]): StatusRapor {
  return daftar.reduce<StatusRapor>(
    (paling, satu) =>
      STATUS_RAPOR.indexOf(satu.status) < STATUS_RAPOR.indexOf(paling) ? satu.status : paling,
    daftar.length === 0 ? "draft" : "distributed",
  );
}

/** Layar kesiapan Wali Kelas — GET /api/kelas/:id/rapor. */
export async function bacaKesiapanKelas(
  db: BasisData,
  kelasRef: string,
): Promise<KesiapanKelas | undefined> {
  const konteks = await cariKonteksKelas(db, kelasRef);
  if (!konteks) return undefined;

  const [kelengkapan, daftar] = await Promise.all([
    daftarKelengkapan(db, kelasRef),
    daftarRaporKelas(db, kelasRef, konteks.periodeRef),
  ]);

  return Object.freeze({
    konteks,
    status: statusKelas(daftar),
    kelengkapan,
    rapor: daftar,
  });
}

/** Menyempitkan `text` basis data menjadi status yang dikenal `ck_rapor_status`. */
export function keStatus(nilai: string): StatusRapor {
  const status = STATUS_RAPOR.find((satu) => satu === nilai);
  if (!status) {
    // Mustahil selama `ck_rapor_status` menyala; dilemparkan alih-alih ditebak
    // supaya kerusakan data tidak berubah menjadi rapor yang salah tampil.
    throw new Error(`Status rapor tidak dikenal: ${nilai}`);
  }
  return status;
}
