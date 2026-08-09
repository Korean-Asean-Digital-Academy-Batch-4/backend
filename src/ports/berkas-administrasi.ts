export const BATAS_UNGGAH_BYTE = 2 * 1024 * 1024;
export const BATAS_BARIS_UNGGAH = 360;
export const BATAS_ENTRI_XLSX = 64;
export const BATAS_XLSX_TIDAK_TERKOMPRESI_BYTE = 16 * 1024 * 1024;

export type BarisAkun = Readonly<{ baris: number; nama: string; namaPengguna: string }>;
export type BarisSiswa = Readonly<{ baris: number; kelas: string; nis: string; nama: string }>;
export type RincianBerkas = Readonly<{ baris: number; sebab: string }>;
export type RincianSiswaBermasalah = Readonly<{ baris: number; nis: string; sebab: string }>;
export type KredensialAwal = Readonly<{
  nama: string;
  namaPengguna: string;
  kataSandiAwal: string;
}>;

export type HasilUrai<T, R extends RincianBerkas> =
  | Readonly<{ berhasil: true; valid: readonly T[]; bermasalah: readonly R[] }>
  | Readonly<{ berhasil: false; sebab: string }>;

export interface BerkasAdministrasi {
  uraiAkunCsv(
    berkas: Buffer,
    peran: "guru" | "siswa",
  ): Promise<HasilUrai<BarisAkun, RincianBerkas>>;
  uraiDaftarSiswaXlsx(berkas: Buffer): Promise<HasilUrai<BarisSiswa, RincianSiswaBermasalah>>;
  buatCsvKredensial(baris: readonly KredensialAwal[]): Promise<Buffer>;
  buatTemplatAkunCsv(peran: "guru" | "siswa"): Promise<Buffer>;
  buatTemplatDaftarSiswaXlsx(): Promise<Buffer>;
}
