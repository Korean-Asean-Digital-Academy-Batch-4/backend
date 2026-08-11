import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { BasisData } from "../drizzle.js";
import type { PenyimpananBerkas } from "../../ports/penyimpanan-berkas.js";
import type { AnggotaArsip, IsiRapor, RaporBerkas } from "../../ports/rapor-berkas.js";
import { pengguna } from "../skema/identitas.js";
import { kelas, periode, tahunAjaran } from "../skema/periode.js";
import { rapor, raporMapel } from "../skema/rapor.js";
import { keStatus, type Pelaksana } from "./kesiapan.js";

/**
 * Berkas rapor — [ARCHITECTURE.md Pasal 11] dan [API.md §8.3–§8.5].
 *
 * Isinya **selalu** dibaca dari `rapor_mapel`, yaitu salinan beku pada saat
 * finalisasi. Karena itu keluaran PDF selalu sama dengan data yang difinalisasi
 * (AC-13), meskipun templat bobot berubah kemudian.
 *
 * Seluruh perenderan berjalan di dalam request yang memicunya — tidak ada
 * antrean, worker, maupun pekerjaan latar (CK-07).
 */

export type DependensiBerkas = Readonly<{
  db: BasisData;
  penyimpanan: PenyimpananBerkas;
  raporBerkas: RaporBerkas;
  sekarang: () => Date;
}>;

/**
 * Bentuk `rapor_mapel.snapshot_komponen` divalidasi di batas aplikasi.
 *
 * Kolomnya `jsonb`, dan basis data hanya menjamin ia berupa larik
 * (`ck_rapor_mapel_snapshot`). Isinya tercetak pada rapor siswa, sehingga
 * bentuknya diperiksa di sini alih-alih dipercaya — [ARCHITECTURE.md Pasal 12].
 */
const skemaSnapshot = z.array(
  z
    .object({
      kode: z.string(),
      nama: z.string(),
      bobot: z.number(),
      nilai: z.number(),
    })
    .strict(),
);

/** Letak berkas satu rapor di dalam penyimpanan. */
export function kunciBerkasRapor(periodeRef: string, raporRef: string): string {
  return `rapor/${periodeRef}/${raporRef}.pdf`;
}

/**
 * Isi satu berkas rapor, dibaca dari salinan beku.
 *
 * `undefined` berarti rapornya belum difinalisasi — tanpa `rapor_mapel` tidak
 * ada yang dapat dirender, dan itu bukan kegagalan melainkan keadaan.
 */
export async function bacaIsiRapor(
  pelaksana: Pelaksana,
  raporRef: string,
): Promise<IsiRapor | undefined> {
  const wali = alias(pengguna, "wali");
  const [baris] = await pelaksana
    .select({
      status: rapor.status,
      catatanWali: rapor.catatanWali,
      difinalisasiPada: rapor.difinalisasiPada,
      siswaNama: pengguna.nama,
      nis: pengguna.namaPengguna,
      kelasNama: kelas.nama,
      tahunAjaranNama: tahunAjaran.nama,
      semester: periode.semester,
      waliKelasNama: wali.nama,
    })
    .from(rapor)
    .innerJoin(pengguna, eq(pengguna.id, rapor.siswaRef))
    .innerJoin(kelas, eq(kelas.id, rapor.kelasRef))
    .innerJoin(periode, eq(periode.id, rapor.periodeRef))
    .innerJoin(tahunAjaran, eq(tahunAjaran.id, periode.tahunAjaranRef))
    .leftJoin(wali, eq(wali.id, kelas.waliKelasRef))
    .where(eq(rapor.id, raporRef))
    .limit(1);

  if (!baris || keStatus(baris.status) === "draft" || !baris.difinalisasiPada) {
    return undefined;
  }

  const mapel = await pelaksana
    .select({
      nama: raporMapel.mapelNama,
      kkm: raporMapel.kkm,
      nilaiAkhir: raporMapel.nilaiAkhir,
      kehadiranPersen: raporMapel.kehadiranPersen,
      snapshotKomponen: raporMapel.snapshotKomponen,
    })
    .from(raporMapel)
    .where(eq(raporMapel.raporRef, raporRef))
    .orderBy(asc(raporMapel.mapelNama));

  return Object.freeze({
    siswaNama: baris.siswaNama,
    nis: baris.nis,
    kelasNama: baris.kelasNama,
    periodeNama: `${baris.tahunAjaranNama} ${baris.semester === "ganjil" ? "Ganjil" : "Genap"}`,
    waliKelasNama: baris.waliKelasNama,
    catatanWali: baris.catatanWali,
    difinalisasiPada: baris.difinalisasiPada,
    mapel: Object.freeze(
      mapel.map((satu) =>
        Object.freeze({
          nama: satu.nama,
          kkm: satu.kkm,
          nilaiAkhir: Number(satu.nilaiAkhir),
          kehadiranPersen: Number(satu.kehadiranPersen),
          komponen: Object.freeze(skemaSnapshot.parse(satu.snapshotKomponen)),
        }),
      ),
    ),
  });
}

export type HasilPastikan =
  Readonly<{ ada: true; kunci: string }> | Readonly<{ ada: false; sebab: "belum_final" }>;

/**
 * Memastikan berkas satu rapor tersedia, merendernya bila belum ada.
 *
 * Inilah jalur cadangan CK-A-07 yang **tidak dapat dihapus**: berkas biasanya
 * sudah ada sejak finalisasi, tetapi anggaran render yang terlampaui maupun
 * penghapusan berkas oleh koreksi Administrator (CK-A-05) membuat jalur ini
 * tetap diperlukan.
 */
export async function pastikanBerkasRapor(
  deps: DependensiBerkas,
  raporRef: string,
  periodeRef: string,
): Promise<HasilPastikan> {
  const kunci = kunciBerkasRapor(periodeRef, raporRef);
  if (await deps.penyimpanan.ada(kunci)) {
    return { ada: true, kunci };
  }

  const isi = await bacaIsiRapor(deps.db, raporRef);
  if (!isi) {
    return { ada: false, sebab: "belum_final" };
  }

  await deps.penyimpanan.simpan(kunci, await deps.raporBerkas.render(isi), "application/pdf");
  await deps.db.update(rapor).set({ kunciBerkas: kunci }).where(eq(rapor.id, raporRef));

  return { ada: true, kunci };
}

export type HasilRenderSekelas = Readonly<{
  terender: number;
  tersisa: readonly string[];
}>;

/**
 * Merender berkas satu kelas dengan **anggaran lunak**.
 *
 * Anggaran diperiksa **sebelum** setiap berkas dimulai, bukan di tengahnya:
 * satu render yang sudah berjalan dibiarkan selesai, karena membatalkannya di
 * tengah jalan hanya membuang pekerjaan tanpa memulihkan waktu. Berkas yang
 * belum sempat dirender dikembalikan apa adanya lewat `tersisa`, dan
 * diselesaikan jalur unduh ([API.md §8.3]).
 *
 * Kegagalan render satu berkas **tidak** menggagalkan yang lain dan tidak
 * pernah dilemparkan ke pemanggil: finalisasi yang sudah `COMMIT` bersifat sah
 * dengan sendirinya, dan berkas hanyalah turunannya.
 */
export async function renderSekelas(
  deps: DependensiBerkas,
  raporRef: readonly string[],
  periodeRef: string,
  anggaranMs: number,
): Promise<HasilRenderSekelas> {
  const mulai = deps.sekarang().getTime();
  let terender = 0;
  const tersisa: string[] = [];

  for (const satu of raporRef) {
    if (deps.sekarang().getTime() - mulai >= anggaranMs) {
      tersisa.push(satu);
      continue;
    }
    try {
      const hasil = await pastikanBerkasRapor(deps, satu, periodeRef);
      if (hasil.ada) {
        terender += 1;
      } else {
        tersisa.push(satu);
      }
    } catch (galat) {
      // Log ringkas berbahasa Inggris tanpa data pribadi — AGENTS.md §5.1.
      console.error("rapor render failed", { rapor: satu, name: namaGalat(galat) });
      tersisa.push(satu);
    }
  }

  return Object.freeze({ terender, tersisa: Object.freeze(tersisa) });
}

/** Satu calon anggota arsip: rapor mana, dan hendak dinamai apa di dalam ZIP. */
export type CalonAnggota = Readonly<{ raporRef: string; siswaNama: string }>;

/**
 * Menyusun arsip sekelas dari berkas yang **sudah ada** — [API.md §8.5].
 *
 * Murni pekerjaan I/O. Berkas yang belum ada tidak dirender di sini; pemanggil
 * menjalankan {@link renderSekelas} lebih dahulu dengan anggaran yang sama.
 */
export async function susunArsipKelas(
  deps: DependensiBerkas,
  calon: readonly CalonAnggota[],
  periodeRef: string,
): Promise<Buffer> {
  const anggota: AnggotaArsip[] = [];
  for (const satu of calon) {
    const isi = await deps.penyimpanan.baca(kunciBerkasRapor(periodeRef, satu.raporRef));
    if (isi) {
      anggota.push({ nama: namaAnggotaArsip(satu), isi });
    }
  }
  return deps.raporBerkas.arsipkan(anggota);
}

/**
 * Nama berkas di dalam arsip.
 *
 * Nama siswa dibersihkan lebih dahulu. Nama orang tidak seharusnya memuat
 * pemisah jalur maupun aksara kendali, tetapi nama anggota arsip adalah salah
 * satu tempat yang paling sering dipakai untuk menulis berkas ke luar direktori
 * tujuan pada saat pengekstrakan; pembersihannya karena itu tidak bergantung
 * pada asumsi tentang isi kolom `nama`. Pengenal rapor disertakan supaya dua
 * siswa bernama sama tidak saling menimpa.
 */
export function namaAnggotaArsip(satu: CalonAnggota): string {
  const bersih = satu.siswaNama
    // Aksara kendali, kedua pemisah jalur, dan aksara yang tidak sah pada nama
    // berkas Windows. Tanda hubung dan apostrof dibiarkan — nama orang memang
    // memuatnya.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const nama = bersih.length > 0 ? bersih : "Siswa";
  return `${nama} (${satu.raporRef}).pdf`;
}

function namaGalat(galat: unknown): string {
  return galat instanceof Error ? galat.name : "Error";
}
