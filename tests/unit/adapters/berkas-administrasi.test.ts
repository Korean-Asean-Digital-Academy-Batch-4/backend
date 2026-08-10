import type { Blob } from "node:buffer";
import type Stream from "node:stream";

import { parse } from "csv-parse/sync";
import writeXlsxFile from "write-excel-file/node";
import type { Feature } from "write-excel-file/node";
import { describe, expect, it } from "vitest";

import { berkasAdministrasiLokal } from "../../../src/adapters/local/berkas-administrasi/index.js";
import {
  BATAS_BARIS_UNGGAH,
  BATAS_ENTRI_XLSX,
  BATAS_XLSX_TIDAK_TERKOMPRESI_BYTE,
} from "../../../src/ports/berkas-administrasi.js";

const berkas = berkasAdministrasiLokal();

async function xlsx(
  baris: readonly (readonly (string | null)[])[],
  jumlahLembar = 1,
): Promise<Buffer> {
  const lembar = Array.from({ length: jumlahLembar }, () => baris.map((row) => [...row]));
  return jumlahLembar === 1
    ? writeXlsxFile(lembar[0]!).toBuffer()
    : writeXlsxFile(
        lembar.map((data, indeks) => ({ data, sheet: `Lembar ${indeks + 1}` })),
      ).toBuffer();
}

function xlsxDenganEntri(tambahan: Readonly<Record<string, string>>): Promise<Buffer> {
  const fitur: Feature<Stream | Buffer | Blob> = {
    files: { write: { files: () => ({ ...tambahan }) } },
  };
  return writeXlsxFile(
    [
      ["Kelas", "NIS", "Nama"],
      ["X-1", "1", "Andi"],
    ],
    {},
    { features: [fitur] },
  ).toBuffer();
}

function ubahUkuranDeklarasiZip(berkas: Buffer, namaEntri: string, ukuran: number): Buffer {
  const hasil = Buffer.from(berkas);
  for (let offset = 0; offset <= hasil.length - 46; offset += 1) {
    if (hasil.readUInt32LE(offset) !== 0x02014b50) continue;
    const panjangNama = hasil.readUInt16LE(offset + 28);
    const panjangEkstra = hasil.readUInt16LE(offset + 30);
    const panjangKomentar = hasil.readUInt16LE(offset + 32);
    const nama = hasil.subarray(offset + 46, offset + 46 + panjangNama).toString("utf8");
    if (nama === namaEntri) {
      hasil.writeUInt32LE(ukuran, offset + 24);
      return hasil;
    }
    offset += 45 + panjangNama + panjangEkstra + panjangKomentar;
  }
  throw new Error("Entri ZIP fixture tidak ditemukan.");
}

describe("uraiAkunCsv", () => {
  it.each([
    ["guru", "Nama,NIP", "198001011001"],
    ["siswa", "Nama,NIS", "2026001"],
  ] as const)("menerima kepala tepat untuk %s", async (peran, kepala, identitas) => {
    const hasil = await berkas.uraiAkunCsv(
      Buffer.from(`\uFEFF${kepala}\r\n Nama Uji ,${identitas}\r\n`, "utf8"),
      peran,
    );

    expect(hasil).toEqual({
      berhasil: true,
      valid: [{ baris: 2, nama: "Nama Uji", namaPengguna: identitas }],
      bermasalah: [],
    });
  });

  it("menolak kepala yang salah atau berulang", async () => {
    await expect(
      berkas.uraiAkunCsv(Buffer.from("Nama,NIP,NIP\nA,1,1"), "guru"),
    ).resolves.toMatchObject({
      berhasil: false,
    });
    await expect(berkas.uraiAkunCsv(Buffer.from("NIP,Nama\n1,A"), "guru")).resolves.toMatchObject({
      berhasil: false,
    });
  });

  it("menolak baris akun yang memuat kolom tambahan", async () => {
    await expect(
      berkas.uraiAkunCsv(Buffer.from("Nama,NIP\nAndi,198001011001,diabaikan"), "guru"),
    ).resolves.toMatchObject({ berhasil: false });
  });

  it.each([
    [" Nama,NIP", "guru"],
    ["Nama ,NIP", "guru"],
    ["Nama, NIP", "guru"],
    ["Nama,NIP ", "guru"],
    [" Nama , NIS ", "siswa"],
  ] as const)("menolak whitespace yang mengubah kepala CSV: %s", async (kepala, peran) => {
    await expect(
      berkas.uraiAkunCsv(Buffer.from(`${kepala}\nAndi,001`), peran),
    ).resolves.toMatchObject({ berhasil: false });
  });

  it("melaporkan setiap bidang kosong dan identitas bukan angka", async () => {
    const hasil = await berkas.uraiAkunCsv(
      Buffer.from("Nama,NIP\n,abc\nBudi,\n,123\nCitra,456"),
      "guru",
    );

    expect(hasil).toEqual({
      berhasil: true,
      valid: [{ baris: 5, nama: "Citra", namaPengguna: "456" }],
      bermasalah: [
        { baris: 2, sebab: "Kolom Nama kosong; NIP hanya boleh berisi angka" },
        { baris: 3, sebab: "Kolom NIP kosong" },
        { baris: 4, sebab: "Kolom Nama kosong" },
      ],
    });
  });

  it("menolak data di atas 360 baris tanpa memotong diam-diam", async () => {
    const baris = Array.from(
      { length: BATAS_BARIS_UNGGAH + 1 },
      (_, indeks) => `Nama ${indeks},${1000 + indeks}`,
    );

    await expect(
      berkas.uraiAkunCsv(Buffer.from(["Nama,NIP", ...baris].join("\n")), "guru"),
    ).resolves.toMatchObject({ berhasil: false });
  });

  it("menerima tepat 360 baris data", async () => {
    const baris = Array.from(
      { length: BATAS_BARIS_UNGGAH },
      (_, indeks) => `Nama ${indeks},${1000 + indeks}`,
    );
    await expect(
      berkas.uraiAkunCsv(Buffer.from(["Nama,NIP", ...baris].join("\n")), "guru"),
    ).resolves.toMatchObject({ berhasil: true, valid: { length: BATAS_BARIS_UNGGAH } });
  });

  it("menolak record CSV di atas 4 KiB", async () => {
    const nama = "a".repeat(4097);
    await expect(
      berkas.uraiAkunCsv(Buffer.from(`Nama,NIS\n${nama},123`), "siswa"),
    ).resolves.toMatchObject({ berhasil: false });
  });
});

describe("uraiDaftarSiswaXlsx", () => {
  it("menerima tepat satu lembar dan mempertahankan kelas tiap baris", async () => {
    const hasil = await berkas.uraiDaftarSiswaXlsx(
      await xlsx([
        ["Kelas", "NIS", "Nama"],
        ["X-1", "001", "Andi"],
        ["X-2", "002", "Budi"],
      ]),
    );

    expect(hasil).toEqual({
      berhasil: true,
      valid: [
        { baris: 2, kelas: "X-1", nis: "001", nama: "Andi" },
        { baris: 3, kelas: "X-2", nis: "002", nama: "Budi" },
      ],
      bermasalah: [],
    });
  });

  it("menolak kepala salah atau kolom berulang", async () => {
    await expect(
      berkas.uraiDaftarSiswaXlsx(
        await xlsx([
          ["Kelas", "NIS", "Nama", "NIS"],
          ["X-1", "1", "Andi", "1"],
        ]),
      ),
    ).resolves.toMatchObject({ berhasil: false });
  });

  it("melaporkan bidang kosong dan NIS bukan angka", async () => {
    const hasil = await berkas.uraiDaftarSiswaXlsx(
      await xlsx([
        ["Kelas", "NIS", "Nama"],
        [null, "abc", null],
        ["X-1", "123", "Andi"],
      ]),
    );

    expect(hasil).toEqual({
      berhasil: true,
      valid: [{ baris: 3, kelas: "X-1", nis: "123", nama: "Andi" }],
      bermasalah: [
        {
          baris: 2,
          kelas: "",
          nis: "abc",
          sebab: "Kolom Kelas kosong; NIS hanya boleh berisi angka; Kolom Nama kosong",
        },
      ],
    });
  });

  it("menolak lebih dari 360 baris data", async () => {
    const baris = Array.from({ length: BATAS_BARIS_UNGGAH + 1 }, (_, indeks) => [
      "X-1",
      String(1000 + indeks),
      `Nama ${indeks}`,
    ]);
    await expect(
      berkas.uraiDaftarSiswaXlsx(await xlsx([["Kelas", "NIS", "Nama"], ...baris])),
    ).resolves.toMatchObject({ berhasil: false });
  });

  it("menolak berkas dengan lebih dari satu worksheet", async () => {
    await expect(
      berkas.uraiDaftarSiswaXlsx(
        await xlsx(
          [
            ["Kelas", "NIS", "Nama"],
            ["X-1", "1", "Andi"],
          ],
          2,
        ),
      ),
    ).resolves.toMatchObject({ berhasil: false });
  });

  it("menolak ZIP dengan lebih dari 64 entri", async () => {
    const tambahan = Object.fromEntries(
      Array.from({ length: BATAS_ENTRI_XLSX }, (_, indeks) => [`padding/${indeks}.txt`, "x"]),
    );
    const berkasBanyakEntri = await xlsxDenganEntri(tambahan);

    await expect(berkas.uraiDaftarSiswaXlsx(berkasBanyakEntri)).resolves.toMatchObject({
      berhasil: false,
    });
  });

  it("menolak total isi ZIP tidak terkompresi di atas 16 MiB", async () => {
    const muatan = "A".repeat(BATAS_XLSX_TIDAK_TERKOMPRESI_BYTE + 1);
    const bomZip = await xlsxDenganEntri({ "padding/bomb.txt": muatan });

    expect(bomZip.length).toBeLessThan(2 * 1024 * 1024);
    await expect(berkas.uraiDaftarSiswaXlsx(bomZip)).resolves.toMatchObject({
      berhasil: false,
    });
  });

  it("mengukur keluaran dekompresi aktual, bukan hanya metadata ZIP", async () => {
    const namaEntri = "padding/bomb.txt";
    const muatan = "A".repeat(BATAS_XLSX_TIDAK_TERKOMPRESI_BYTE + 1);
    const asli = await xlsxDenganEntri({ [namaEntri]: muatan });
    const metadataPalsu = ubahUkuranDeklarasiZip(asli, namaEntri, 1);

    expect(metadataPalsu.length).toBeLessThan(2 * 1024 * 1024);
    await expect(berkas.uraiDaftarSiswaXlsx(metadataPalsu)).resolves.toMatchObject({
      berhasil: false,
    });
  });
});

describe("pembentuk berkas", () => {
  it("menetralkan formula pada setiap sel teks CSV kredensial", async () => {
    const awalan = ["=", "+", "-", "@"] as const;
    const csv = await berkas.buatCsvKredensial(
      awalan.map((nilai) => ({
        nama: `${nilai}nama`,
        namaPengguna: `${nilai}pengguna`,
        kataSandiAwal: `${nilai}sandi`,
      })),
    );
    const hasil = parse(csv, { columns: false }) as string[][];

    expect(hasil[0]).toEqual(["nama", "nama_pengguna", "kata_sandi_awal"]);
    expect(hasil.slice(1)).toEqual(
      awalan.map((nilai) => [`'${nilai}nama`, `'${nilai}pengguna`, `'${nilai}sandi`]),
    );
  });

  it.each([
    ["guru", "Nama,NIP\n"],
    ["siswa", "Nama,NIS\n"],
  ] as const)("membuat templat CSV %s dengan kepala exact", async (peran, expected) => {
    expect((await berkas.buatTemplatAkunCsv(peran)).toString("utf8")).toBe(expected);
  });

  it("membuat templat XLSX satu lembar dengan kepala exact", async () => {
    const hasil = await berkas.uraiDaftarSiswaXlsx(await berkas.buatTemplatDaftarSiswaXlsx());
    expect(hasil).toEqual({ berhasil: true, valid: [], bermasalah: [] });
  });
});
