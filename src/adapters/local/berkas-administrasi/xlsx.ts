import { crc32 } from "node:zlib";

import { readSheet } from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import type { Readable } from "node:stream";

import type {
  BarisSiswa,
  HasilUrai,
  RincianSiswaBermasalah,
} from "../../../ports/berkas-administrasi.js";
import {
  BATAS_BARIS_UNGGAH,
  BATAS_ENTRI_XLSX,
  BATAS_XLSX_TIDAK_TERKOMPRESI_BYTE,
} from "../../../ports/berkas-administrasi.js";

const SEBAB_BERKAS_TIDAK_SAH = "Berkas XLSX tidak sah.";
const POLA_WORKSHEET = /^xl\/worksheets\/sheet[^/]*\.xml$/;

export async function uraiDaftarSiswaXlsx(
  berkas: Buffer,
): Promise<HasilUrai<BarisSiswa, RincianSiswaBermasalah>> {
  if (!(await preflightXlsx(berkas))) {
    return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };
  }

  try {
    const semua = await readSheet(berkas);
    if (semua.length > BATAS_BARIS_UNGGAH + 1) {
      return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };
    }

    const kepala = semua[0];
    if (!kepala || !kepalaTepat(kepala)) {
      return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };
    }

    const valid: BarisSiswa[] = [];
    const bermasalah: RincianSiswaBermasalah[] = [];
    for (let indeks = 1; indeks < semua.length; indeks += 1) {
      const baris = semua[indeks]!;
      if (baris.length > 3) return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };

      const kelas = keTeks(baris[0]);
      const nis = keTeks(baris[1]);
      const nama = keTeks(baris[2]);
      const sebab = rincianSiswa(kelas, nis, nama);
      if (sebab.length > 0) {
        bermasalah.push({ baris: indeks + 1, kelas, nis, sebab: sebab.join("; ") });
      } else {
        valid.push({ baris: indeks + 1, kelas, nis, nama });
      }
    }

    return { berhasil: true, valid, bermasalah };
  } catch {
    return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };
  }
}

export async function buatTemplatDaftarSiswaXlsx(): Promise<Buffer> {
  return writeXlsxFile([["Kelas", "NIS", "Nama"]]).toBuffer();
}

function kepalaTepat(kepala: readonly unknown[]): boolean {
  return (
    kepala.length === 3 && kepala[0] === "Kelas" && kepala[1] === "NIS" && kepala[2] === "Nama"
  );
}

function keTeks(nilai: unknown): string {
  return typeof nilai === "string"
    ? nilai.trim()
    : typeof nilai === "number" && Number.isFinite(nilai)
      ? String(nilai)
      : "";
}

function rincianSiswa(kelas: string, nis: string, nama: string): string[] {
  return [
    ...(kelas.length === 0 ? ["Kolom Kelas kosong"] : []),
    ...(nis.length === 0
      ? ["Kolom NIS kosong"]
      : /^\d+$/.test(nis)
        ? []
        : ["NIS hanya boleh berisi angka"]),
    ...(nama.length === 0 ? ["Kolom Nama kosong"] : []),
  ];
}

function preflightXlsx(berkas: Buffer): Promise<boolean> {
  return new Promise((selesai) => {
    yauzl.fromBuffer(berkas, { lazyEntries: true }, (galat, zip) => {
      if (galat || !zip) {
        selesai(false);
        return;
      }
      periksaDirektori(zip, selesai);
    });
  });
}

function periksaDirektori(zip: ZipFile, selesai: (sah: boolean) => void): void {
  let sudahSelesai = false;
  let jumlahEntri = 0;
  let jumlahWorksheet = 0;
  let totalTidakTerkompresi = 0;
  let totalAktual = 0;
  let aliranAktif: Readable | undefined;

  const tuntaskan = (sah: boolean): void => {
    if (sudahSelesai) return;
    sudahSelesai = true;
    if (aliranAktif) {
      aliranAktif.removeAllListeners();
      aliranAktif.on("error", () => undefined);
      aliranAktif.destroy();
    }
    zip.removeAllListeners();
    zip.close();
    selesai(sah);
  };

  zip.on("entry", (entri: Entry) => {
    jumlahEntri += 1;
    totalTidakTerkompresi += entri.uncompressedSize;
    if (POLA_WORKSHEET.test(entri.fileName)) jumlahWorksheet += 1;

    if (
      jumlahEntri > BATAS_ENTRI_XLSX ||
      !Number.isSafeInteger(totalTidakTerkompresi) ||
      totalTidakTerkompresi > BATAS_XLSX_TIDAK_TERKOMPRESI_BYTE ||
      jumlahWorksheet > 1
    ) {
      tuntaskan(false);
      return;
    }

    zip.openReadStream(entri, (galat, aliran) => {
      if (galat || !aliran) {
        tuntaskan(false);
        return;
      }
      aliranAktif = aliran;
      let ukuranAktual = 0;
      let checksum = 0;
      aliran.on("data", (potongan: Buffer) => {
        if (sudahSelesai) return;
        ukuranAktual += potongan.length;
        totalAktual += potongan.length;
        checksum = crc32(potongan, checksum);
        if (
          ukuranAktual > entri.uncompressedSize ||
          totalAktual > BATAS_XLSX_TIDAK_TERKOMPRESI_BYTE
        ) {
          tuntaskan(false);
        }
      });
      aliran.once("error", () => tuntaskan(false));
      aliran.once("end", () => {
        aliranAktif = undefined;
        if (ukuranAktual !== entri.uncompressedSize || checksum >>> 0 !== entri.crc32 >>> 0) {
          tuntaskan(false);
          return;
        }
        zip.readEntry();
      });
      aliran.resume();
    });
  });
  zip.once("error", () => tuntaskan(false));
  zip.once("end", () => tuntaskan(jumlahWorksheet === 1));
  zip.readEntry();
}
