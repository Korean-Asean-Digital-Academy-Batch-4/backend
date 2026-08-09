import { parse } from "csv-parse";
import { stringify } from "csv-stringify/sync";

import type {
  BarisAkun,
  HasilUrai,
  KredensialAwal,
  RincianBerkas,
} from "../../../ports/berkas-administrasi.js";
import { BATAS_BARIS_UNGGAH } from "../../../ports/berkas-administrasi.js";

const SEBAB_BERKAS_TIDAK_SAH = "Berkas CSV tidak sah.";
const AWAL_FORMULA = /^[=+\-@\t\r]/;

export async function uraiAkunCsv(
  berkas: Buffer,
  peran: "guru" | "siswa",
): Promise<HasilUrai<BarisAkun, RincianBerkas>> {
  const kepalaPengenal = peran === "guru" ? "NIP" : "NIS";

  try {
    const pengurai = parse(berkas, {
      bom: true,
      columns: false,
      max_record_size: 4096,
      skip_empty_lines: false,
      trim: false,
    });
    const semua: string[][] = [];

    for await (const nilai of pengurai) {
      if (!Array.isArray(nilai) || nilai.some((kolom) => typeof kolom !== "string")) {
        return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };
      }
      semua.push(nilai as string[]);
      if (semua.length > BATAS_BARIS_UNGGAH + 1) {
        pengurai.destroy();
        return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };
      }
    }

    const kepala = semua[0];
    if (!kepala || kepala.length !== 2 || kepala[0] !== "Nama" || kepala[1] !== kepalaPengenal) {
      return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };
    }

    const valid: BarisAkun[] = [];
    const bermasalah: RincianBerkas[] = [];
    for (let indeks = 1; indeks < semua.length; indeks += 1) {
      const baris = semua[indeks]!;
      const nama = (baris[0] ?? "").trim();
      const namaPengguna = (baris[1] ?? "").trim();
      const sebab = rincianAkun(nama, namaPengguna, kepalaPengenal);
      if (sebab.length > 0) {
        bermasalah.push({ baris: indeks + 1, sebab: sebab.join("; ") });
      } else {
        valid.push({ baris: indeks + 1, nama, namaPengguna });
      }
    }

    return { berhasil: true, valid, bermasalah };
  } catch {
    return { berhasil: false, sebab: SEBAB_BERKAS_TIDAK_SAH };
  }
}

function rincianAkun(nama: string, namaPengguna: string, label: "NIP" | "NIS"): string[] {
  return [
    ...(nama.length === 0 ? ["Kolom Nama kosong"] : []),
    ...(namaPengguna.length === 0
      ? [`Kolom ${label} kosong`]
      : /^\d+$/.test(namaPengguna)
        ? []
        : [`${label} hanya boleh berisi angka`]),
  ];
}

export function buatCsvKredensial(baris: readonly KredensialAwal[]): Buffer {
  const data = [
    ["nama", "nama_pengguna", "kata_sandi_awal"],
    ...baris.map((item) =>
      [item.nama, item.namaPengguna, item.kataSandiAwal].map(netralisasiFormula),
    ),
  ];
  return Buffer.from(stringify(data, { record_delimiter: "\n" }), "utf8");
}

export function buatTemplatAkunCsv(peran: "guru" | "siswa"): Buffer {
  const pengenal = peran === "guru" ? "NIP" : "NIS";
  return Buffer.from(stringify([["Nama", pengenal]], { record_delimiter: "\n" }), "utf8");
}

function netralisasiFormula(nilai: string): string {
  return AWAL_FORMULA.test(nilai) ? `'${nilai}` : nilai;
}
