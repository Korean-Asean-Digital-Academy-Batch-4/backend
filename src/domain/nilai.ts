import { SEN_PER_SATUAN, bagiBulatSetengahKeAtas, dariSen, keSen } from "./angka.js";

/**
 * Perhitungan nilai akhir mata pelajaran. Tanpa I/O, tanpa basis data.
 *
 * [PRD.md §8.3]:
 *
 *     Nilai akhir = Σ (nilai komponen × bobot komponen) ÷ 100
 */

/** Jumlah bobot yang wajib dicapai — I-10, P4, AC-04. */
export const TOTAL_BOBOT_WAJIB = 100;

export type Komponen = {
  readonly kode: string;
  readonly bobot: number;
};

export type NilaiKomponen = {
  readonly kode: string;
  readonly nilai: number;
};

export type HasilPeriksaBobot =
  { readonly sah: true } | { readonly sah: false; readonly total: number; readonly pesan: string };

export type HasilKelengkapan =
  { readonly lengkap: true } | { readonly lengkap: false; readonly kurang: readonly string[] };

export type HasilNilaiAkhir =
  | { readonly sah: true; readonly nilaiAkhir: number }
  | {
      readonly sah: false;
      readonly sebab: "bobot_tidak_seratus";
      readonly total: number;
      readonly pesan: string;
    }
  | {
      readonly sah: false;
      readonly sebab: "komponen_belum_lengkap";
      readonly kurang: readonly string[];
    };

/**
 * Memeriksa I-10, dan menghasilkan pesan AC-04 yang menyebutkan total saat ini.
 *
 * Basis data sudah menolak keadaan ini lewat `trg_komponen_bobot` (CK-S-05);
 * yang dikerjakan di sini adalah menyusun pesannya bagi pengguna, bukan
 * menggantikan penegakannya.
 */
export function periksaBobot(komponen: readonly Komponen[]): HasilPeriksaBobot {
  const total = komponen.reduce((jumlah, satu) => jumlah + satu.bobot, 0);

  if (total === TOTAL_BOBOT_WAJIB) {
    return { sah: true };
  }

  return {
    sah: false,
    total,
    pesan: `Jumlah bobot komponen penilaian harus tepat ${TOTAL_BOBOT_WAJIB}, saat ini ${total}.`,
  };
}

/**
 * Memeriksa apakah seluruh komponen sudah memiliki nilai — I-12.
 *
 * Nilai nol adalah nilai yang terisi. Yang menandakan kosong adalah ketiadaan
 * entri, bukan angka nol; inilah bentuk I-12 di lapisan perhitungan.
 */
export function periksaKelengkapan(
  komponen: readonly Komponen[],
  nilai: readonly NilaiKomponen[],
): HasilKelengkapan {
  const terisi = new Set(nilai.map((satu) => satu.kode));
  const kurang = komponen.filter((satu) => !terisi.has(satu.kode)).map((satu) => satu.kode);

  return kurang.length === 0 ? { lengkap: true } : { lengkap: false, kurang };
}

/**
 * Menghitung nilai akhir satu mata pelajaran bagi satu siswa.
 *
 * Menolak menghitung selama data belum lengkap, mengikuti [PRD.md §8.3] —
 * *"Nilai final tidak ditampilkan sebagai hasil final selama data belum
 * lengkap"*. Ketiadaan hasil dinyatakan lewat tipe, bukan lewat angka
 * pengganti yang dapat tercetak pada rapor tanpa seorang pun menyadarinya.
 */
export function hitungNilaiAkhir(
  komponen: readonly Komponen[],
  nilai: readonly NilaiKomponen[],
): HasilNilaiAkhir {
  const bobot = periksaBobot(komponen);
  if (!bobot.sah) {
    return { sah: false, sebab: "bobot_tidak_seratus", total: bobot.total, pesan: bobot.pesan };
  }

  const kelengkapan = periksaKelengkapan(komponen, nilai);
  if (!kelengkapan.lengkap) {
    return { sah: false, sebab: "komponen_belum_lengkap", kurang: kelengkapan.kurang };
  }

  // Map atas `nilai` sekaligus membuang entri kembar: satu komponen menyumbang
  // paling banyak satu kali, sejalan dengan `uq_nilai`.
  const senPerKode = new Map(nilai.map((satu) => [satu.kode, keSen(satu.nilai)]));
  const bobotPerKode = new Map(komponen.map((satu) => [satu.kode, satu.bobot]));

  let jumlah = 0;
  for (const [kode, sen] of senPerKode) {
    const bobot = bobotPerKode.get(kode);
    // Nilai atas komponen yang tidak ada pada templat tidak ikut membobot.
    if (bobot === undefined) continue;
    jumlah += sen * bobot;
  }

  return { sah: true, nilaiAkhir: dariSen(bagiBulatSetengahKeAtas(jumlah, SEN_PER_SATUAN)) };
}
