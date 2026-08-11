import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { penyimpananBerkasLokal } from "../src/adapters/local/penyimpanan-berkas.js";
import { raporBerkasLokal } from "../src/adapters/local/rapor-berkas/index.js";
import { ANGGARAN_RENDER_MS, type IsiRapor } from "../src/ports/rapor-berkas.js";

/**
 * Pengukuran lama render tiga puluh berkas rapor — [API.md §13.3].
 *
 * §13.3 menyebut satu angka yang menentukan apakah CK-API-12 bertahan: lama
 * render tiga puluh PDF pdfmake berurutan beserta unggahannya, **di dalam fungsi
 * Lambda 1024 MB arm64**. Angka itu tidak dapat diambil dari mesin pengembang.
 *
 * Yang diukur skrip ini adalah **pembandingnya**: perenderan yang sama, dengan
 * penyimpanan disk lokal menggantikan S3. Ia menjawab "apakah perenderannya
 * sendiri masuk akal", bukan "apakah anggaran 20 detik terpenuhi di produksi".
 * Angka Lambda tetap menunggu Jalur B naik ([AGENTS.md §8.2]).
 *
 * ```bash
 * npm run ukur:render
 * ```
 */

const JUMLAH_RAPOR = 30;
const JUMLAH_MAPEL = 10;
const JUMLAH_KOMPONEN = 8;

function isiContoh(nomor: number): IsiRapor {
  return {
    siswaNama: `Siswa Contoh ${nomor}`,
    nis: `20270${String(nomor).padStart(3, "0")}`,
    kelasNama: "XII IPA 1",
    periodeNama: "2027/2028 Ganjil",
    waliKelasNama: "Wali Kelas Contoh",
    catatanWali:
      "Menunjukkan perkembangan yang baik pada semester ini, terutama pada mata pelajaran eksakta. Kehadiran terjaga dan keterlibatan di kelas meningkat.",
    difinalisasiPada: new Date("2027-12-18T03:15:00.000Z"),
    mapel: Array.from({ length: JUMLAH_MAPEL }, (_, urutanMapel) => ({
      nama: `Mata Pelajaran ${urutanMapel + 1}`,
      kkm: 75,
      nilaiAkhir: 80 + (urutanMapel % 10),
      kehadiranPersen: 90 + (urutanMapel % 10),
      komponen: Array.from({ length: JUMLAH_KOMPONEN }, (_, urutanKomponen) => ({
        kode: `K${urutanKomponen + 1}`,
        nama: `Komponen Penilaian ${urutanKomponen + 1}`,
        bobot: urutanKomponen < 6 ? 10 : 20,
        nilai: 70 + urutanKomponen,
      })),
    })),
  };
}

async function ukur(): Promise<void> {
  const akar = await mkdtemp(join(tmpdir(), "edutrack-ukur-render-"));
  const penyimpanan = penyimpananBerkasLokal(akar);
  const berkas = raporBerkasLokal();

  try {
    // Satu render pemanasan dibuang: pemuatan font dan penyiapan pdfmake hanya
    // terjadi sekali per proses, dan menghitungnya sebagai bagian dari tiga
    // puluh render membuat angkanya terbaca lebih buruk daripada kenyataannya.
    await berkas.render(isiContoh(0));

    const perRapor: number[] = [];
    const mulai = performance.now();
    for (let nomor = 1; nomor <= JUMLAH_RAPOR; nomor += 1) {
      const mulaiSatu = performance.now();
      const pdf = await berkas.render(isiContoh(nomor));
      await penyimpanan.simpan(`rapor/ukur/${nomor}.pdf`, pdf, "application/pdf");
      perRapor.push(performance.now() - mulaiSatu);
    }
    const total = performance.now() - mulai;

    const terurut = [...perRapor].sort((a, b) => a - b);
    console.log(`Berkas dirender      : ${JUMLAH_RAPOR}`);
    console.log(`Mata pelajaran/rapor : ${JUMLAH_MAPEL} × ${JUMLAH_KOMPONEN} komponen`);
    console.log(`Total                : ${total.toFixed(0)} ms`);
    console.log(`Rata-rata per rapor  : ${(total / JUMLAH_RAPOR).toFixed(0)} ms`);
    console.log(`Terlama satu rapor   : ${terurut.at(-1)!.toFixed(0)} ms`);
    console.log(`Anggaran lunak       : ${ANGGARAN_RENDER_MS} ms`);
    console.log(
      total <= ANGGARAN_RENDER_MS
        ? `Muat dalam anggaran, dengan sisa ${(ANGGARAN_RENDER_MS - total).toFixed(0)} ms`
        : `MELAMPAUI anggaran sebesar ${(total - ANGGARAN_RENDER_MS).toFixed(0)} ms`,
    );
    console.log(
      "Catatan: diukur pada mesin ini dengan penyimpanan disk lokal, bukan pada Lambda 1024 MB arm64.",
    );
  } finally {
    await rm(akar, { recursive: true, force: true });
  }
}

await ukur();
