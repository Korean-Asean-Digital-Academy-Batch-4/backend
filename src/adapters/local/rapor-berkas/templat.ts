import type { IsiRapor, MapelCetak } from "../../../ports/rapor-berkas.js";

/**
 * Tata letak berkas rapor — **SEMENTARA**.
 *
 * [Techstack.md §9] butir 2 mencatat *format rapor resmi sekolah* sebagai hal
 * yang belum diputuskan, menunggu validasi **V5** pada
 * [ATURAN-DAN-KRITERIA.md §5]. Sampai V5 turun, tata letak di bawah ini adalah
 * susunan kerja: benar isinya, belum tentu benar bentuknya.
 *
 * Seluruh keputusan tata letak sengaja dikurung di dalam berkas ini. Penggantian
 * setelah V5 turun tidak menyentuh perender, port, lapisan data, maupun rute —
 * yang berubah hanya definisi dokumen yang dikembalikan fungsi ini.
 *
 * Angkanya dibaca dari salinan beku `rapor_mapel`, bukan dihitung ulang; itulah
 * yang membuat AC-13 tetap terpenuhi meskipun templat bobot berubah kemudian
 * ([RFC-001 §5.5]).
 */

/**
 * Bagian definisi dokumen pdfmake yang dipakai templat ini.
 *
 * Dinyatakan sendiri, **bukan** diambil dari `@types/pdfmake`. Berkas
 * `interfaces.d.ts` paket tersebut dibuka dengan `/// <reference lib="dom" />`,
 * sehingga satu impor tipe darinya menarik seluruh pustaka DOM ke dalam program
 * yang sepenuhnya Node. Akibatnya `Blob` dan `BlobPart` bawaan DOM menggantikan
 * milik Node, dan berkas lain yang menyusun `FormData` dari `Buffer` berhenti
 * ter-typecheck — kegagalan yang muncul jauh dari sebabnya.
 */
export type DefinisiDokumen = Readonly<{
  info: Readonly<{ title: string }>;
  pageSize: string;
  pageMargins: readonly [number, number, number, number];
  defaultStyle: Readonly<Record<string, unknown>>;
  styles: Readonly<Record<string, Record<string, unknown>>>;
  content: readonly unknown[];
}>;

/** Satu simpul isi dokumen. Bentuk rincinya urusan pdfmake, bukan urusan tipe ini. */
type Simpul = Record<string, unknown>;

/** Seluruh waktu tampil memakai WIB, sejalan dengan `+07:00` pada [API.md §2.4]. */
const ZONA_WAKTU = "Asia/Jakarta";

const PEMFORMAT_TANGGAL = new Intl.DateTimeFormat("id-ID", {
  timeZone: ZONA_WAKTU,
  day: "numeric",
  month: "long",
  year: "numeric",
});

const TANPA_ISI = "—";

/** Dua desimal berkoma, mengikuti `numeric(5,2)` dan kelaziman Indonesia. */
function angka(nilai: number): string {
  return nilai.toFixed(2).replace(".", ",");
}

function baris(label: string, isi: string | null): Simpul[] {
  return [{ text: label, style: "label" }, { text: isi ?? TANPA_ISI }];
}

function tabelKomponen(mapel: MapelCetak): Simpul {
  return {
    table: {
      widths: ["*", "auto", "auto"],
      body: [
        [
          { text: "Komponen", style: "kepalaTabel" },
          { text: "Bobot", style: "kepalaTabel", alignment: "right" },
          { text: "Nilai", style: "kepalaTabel", alignment: "right" },
        ],
        ...mapel.komponen.map((satu) => [
          { text: `${satu.nama} (${satu.kode})` },
          { text: `${satu.bobot}%`, alignment: "right" },
          { text: angka(satu.nilai), alignment: "right" },
        ]),
      ],
    },
    layout: "lightHorizontalLines",
    margin: [0, 4, 0, 12],
  };
}

function bagianMapel(mapel: MapelCetak): Simpul[] {
  return [
    {
      columns: [
        { text: mapel.nama, style: "judulMapel" },
        {
          text: `KKM ${mapel.kkm}   ·   Nilai akhir ${angka(mapel.nilaiAkhir)}   ·   Kehadiran ${angka(mapel.kehadiranPersen)}%`,
          alignment: "right",
          style: "ringkasMapel",
        },
      ],
      margin: [0, 8, 0, 0],
    },
    tabelKomponen(mapel),
  ];
}

export function susunDokumenRapor(isi: IsiRapor): DefinisiDokumen {
  return {
    info: { title: `Rapor ${isi.siswaNama} — ${isi.periodeNama}` },
    pageSize: "A4",
    pageMargins: [40, 48, 40, 48],
    defaultStyle: { font: "Roboto", fontSize: 10 },
    styles: {
      judul: { fontSize: 16, bold: true },
      subjudul: { fontSize: 11, color: "#444444", margin: [0, 2, 0, 12] },
      label: { color: "#666666" },
      judulMapel: { fontSize: 12, bold: true },
      ringkasMapel: { fontSize: 9, color: "#444444" },
      kepalaTabel: { bold: true, fontSize: 9 },
      judulCatatan: { bold: true, margin: [0, 16, 0, 4] },
      kaki: { fontSize: 8, color: "#666666", margin: [0, 24, 0, 0] },
    },
    content: [
      { text: "Rapor Semester", style: "judul" },
      { text: isi.periodeNama, style: "subjudul" },
      {
        table: {
          widths: ["auto", "*"],
          body: [
            baris("Nama", isi.siswaNama),
            baris("NIS", isi.nis),
            baris("Kelas", isi.kelasNama),
            baris("Wali Kelas", isi.waliKelasNama),
          ],
        },
        layout: "noBorders",
        margin: [0, 0, 0, 12],
      },
      ...isi.mapel.flatMap(bagianMapel),
      { text: "Catatan Wali Kelas", style: "judulCatatan" },
      { text: isi.catatanWali ?? TANPA_ISI },
      {
        text: `Difinalisasi pada ${PEMFORMAT_TANGGAL.format(isi.difinalisasiPada)}`,
        style: "kaki",
      },
    ],
  };
}
