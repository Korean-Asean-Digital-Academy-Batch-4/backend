import type { IsiRapor } from "../../../ports/rapor-berkas.js";

/**
 * Tata letak berkas rapor — [ARCHITECTURE.md §11.3] dan **CK-A-10**.
 *
 * Tiga bagian, berurutan dari atas: kepala berisi periode akademik beserta
 * identitas siswa dan wali kelas, satu tabel berkolom **No, Mata Pelajaran,
 * KKM, Nilai Akhir, Kehadiran**, lalu catatan wali kelas di kaki. Bentuknya
 * diambil dari rapor resmi yang dipakai sekolah, menjawab **V5**.
 *
 * Seluruh keputusan tata letak sengaja dikurung di dalam berkas ini. Perubahan
 * bentuk kelak tidak menyentuh perender, port, lapisan data, maupun rute.
 *
 * **Rincian komponen tidak dicetak.** `rapor_mapel.snapshot_komponen` tetap
 * dibekukan pada saat finalisasi — ia dasar pertanggungjawaban angka, bukan
 * bahan cetak (CK-A-10). Angka pada tabel di bawah dibaca dari salinan beku
 * itu, bukan dihitung ulang; itulah yang membuat AC-13 tetap terpenuhi
 * meskipun templat bobot berubah kemudian ([RFC-001 §5.5]).
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

/** Ditampilkan pada bidang yang memang belum terisi, bukan string kosong. */
const TANPA_ISI = "—";

/** Dua desimal berkoma, mengikuti `numeric(5,2)` dan kelaziman Indonesia. */
function angka(nilai: number): string {
  return nilai.toFixed(2).replace(".", ",");
}

function barisIdentitas(label: string, isi: string | null): Simpul[] {
  return [{ text: label, style: "label" }, { text: isi ?? TANPA_ISI }];
}

function kepalaTabel(): Simpul[] {
  return [
    { text: "No", style: "kepalaTabel", alignment: "right" },
    { text: "Mata Pelajaran", style: "kepalaTabel" },
    { text: "KKM", style: "kepalaTabel", alignment: "right" },
    { text: "Nilai Akhir", style: "kepalaTabel", alignment: "right" },
    { text: "Kehadiran", style: "kepalaTabel", alignment: "right" },
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
      subjudul: { fontSize: 11, color: "#444444", margin: [0, 2, 0, 14] },
      label: { color: "#666666" },
      kepalaTabel: { bold: true, fontSize: 9 },
      judulCatatan: { bold: true, margin: [0, 20, 0, 4] },
    },
    content: [
      { text: "Rapor Semester", style: "judul" },
      { text: isi.periodeNama, style: "subjudul" },
      {
        table: {
          widths: ["auto", "*"],
          body: [
            barisIdentitas("Nama", isi.siswaNama),
            barisIdentitas("NIS", isi.nis),
            barisIdentitas("Kelas", isi.kelasNama),
            barisIdentitas("Wali Kelas", isi.waliKelasNama),
          ],
        },
        layout: "noBorders",
        margin: [0, 0, 0, 16],
      },
      {
        table: {
          headerRows: 1,
          widths: ["auto", "*", "auto", "auto", "auto"],
          body: [
            kepalaTabel(),
            ...isi.mapel.map((satu, urutan) => [
              { text: String(urutan + 1), alignment: "right" },
              { text: satu.nama },
              { text: String(satu.kkm), alignment: "right" },
              { text: angka(satu.nilaiAkhir), alignment: "right" },
              { text: `${angka(satu.kehadiranPersen)}%`, alignment: "right" },
            ]),
          ],
        },
        layout: "lightHorizontalLines",
      },
      { text: "Catatan Wali Kelas", style: "judulCatatan" },
      { text: isi.catatanWali ?? TANPA_ISI },
    ],
  };
}
