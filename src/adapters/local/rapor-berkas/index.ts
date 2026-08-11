import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";

import type { AnggotaArsip, IsiRapor, RaporBerkas } from "../../../ports/rapor-berkas.js";
import { susunDokumenRapor } from "./templat.js";

/**
 * Perender berkas rapor — pdfmake untuk PDF, yazl untuk arsip.
 *
 * Keduanya CommonJS dan tidak menyediakan ekspor bernama yang dapat diimpor
 * langsung dari modul ESM, sehingga dimuat lewat `createRequire`. Tidak ada
 * pekerjaan latar yang ditambahkan (CK-07): perenderan selalu berjalan di dalam
 * request yang memicunya — [ARCHITECTURE.md Pasal 11].
 */

const muat = createRequire(import.meta.url);

type DokumenPdf = { getBuffer(): Promise<Buffer> };
type Pdfmake = {
  addFonts(fonts: unknown): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  setLocalAccessPolicy(callback: (path: string) => boolean): void;
  createPdf(definisi: unknown): DokumenPdf;
};
type BerkasZip = {
  addBuffer(isi: Buffer, nama: string): void;
  end(): void;
  outputStream: NodeJS.ReadableStream;
};

let pdfmakeTerpasang: Pdfmake | undefined;

/**
 * Menyiapkan pdfmake satu kali.
 *
 * Kedua kebijakan akses **ditutup**. Definisi dokumen disusun dari data basis
 * data, dan pdfmake bersedia mengambil gambar dari URL maupun berkas lokal bila
 * diminta; menutup keduanya memastikan satu nilai yang lolos ke definisi dokumen
 * tidak dapat berubah menjadi permintaan jaringan keluar atau pembacaan berkas
 * server. Jaringan ditutup tanpa kecuali; berkas lokal dibuka **hanya** untuk
 * direktori font pdfmake sendiri, karena berkas `.ttf` Roboto memang dibaca dari
 * disk pada saat perenderan.
 */
function pdfmake(): Pdfmake {
  if (pdfmakeTerpasang) return pdfmakeTerpasang;
  const direktoriFont = resolve(dirname(muat.resolve("pdfmake/fonts/Roboto"))) + sep;
  const alat = muat("pdfmake") as Pdfmake;
  alat.setUrlAccessPolicy(() => false);
  alat.setLocalAccessPolicy((jalan) => resolve(jalan).startsWith(direktoriFont));
  alat.addFonts(muat("pdfmake/fonts/Roboto"));
  pdfmakeTerpasang = alat;
  return alat;
}

export function raporBerkasLokal(): RaporBerkas {
  return {
    async render(isi: IsiRapor): Promise<Buffer> {
      return pdfmake().createPdf(susunDokumenRapor(isi)).getBuffer();
    },

    arsipkan(anggota: readonly AnggotaArsip[]): Promise<Buffer> {
      const { ZipFile } = muat("yazl") as { ZipFile: new () => BerkasZip };
      const zip = new ZipFile();
      for (const satu of anggota) {
        zip.addBuffer(satu.isi, satu.nama);
      }
      zip.end();

      return new Promise<Buffer>((selesai, gagal) => {
        const potongan: Buffer[] = [];
        zip.outputStream.on("data", (bagian: Buffer) => potongan.push(bagian));
        zip.outputStream.on("end", () => selesai(Buffer.concat(potongan)));
        zip.outputStream.on("error", gagal);
      });
    },
  };
}
