import { hitungNilaiAkhir, type Komponen, type NilaiKomponen } from "./nilai.js";
import { hitungPersentaseKehadiran, type StatusPresensi } from "./presensi.js";

/**
 * Transisi status rapor beserta penyusunan salinan bekunya. Tanpa I/O, tanpa
 * basis data.
 *
 * [PRD.md §9] dan [RFC-001 §5.5]: status bergerak maju
 * `draft → finalized → distributed`, dan **tidak tersedia mekanisme buka
 * kembali**. Penegakan utamanya berada di basis data lewat
 * `trg_rapor_status_maju` (CK-S-05); berkas ini menolak lebih awal dan
 * menyusun pesannya bagi pengguna.
 */

/** Himpunan tertutup dan berurutan, sama persis dengan `ck_rapor_status`. */
export const STATUS_RAPOR = ["draft", "finalized", "distributed"] as const;

export type StatusRapor = (typeof STATUS_RAPOR)[number];

export type HasilTransisi =
  { readonly sah: true } | { readonly sah: false; readonly pesan: string };

/** Kedudukan status pada urutan maju, dimulai dari 1. */
export function urutanStatus(status: StatusRapor): number {
  return STATUS_RAPOR.indexOf(status) + 1;
}

/**
 * I-21 — status rapor hanya bergerak maju, dan hanya satu langkah.
 *
 * Lompatan `draft → distributed` ditolak meskipun arahnya maju: distribusi
 * mengandaikan rapor sudah difinalisasi beserta `rapor_mapel` yang membeku, dan
 * `ck_rapor_finalisasi` memang menolak status di luar draft tanpa pencatatan
 * siapa yang memfinalisasi.
 */
export function periksaTransisi(dari: StatusRapor, ke: StatusRapor): HasilTransisi {
  const selisih = urutanStatus(ke) - urutanStatus(dari);

  if (selisih <= 0) {
    return {
      sah: false,
      pesan: `Status rapor hanya bergerak maju, tidak dapat kembali dari ${dari} ke ${ke}.`,
    };
  }

  if (selisih > 1) {
    return {
      sah: false,
      pesan: `Status rapor bergerak satu langkah setiap kali, tidak dapat langsung dari ${dari} ke ${ke}.`,
    };
  }

  return { sah: true };
}

/**
 * I-22 — rapor yang sudah final terkunci bagi Guru maupun Wali Kelas (AC-14).
 *
 * Administrator tidak melewati fungsi ini: kewenangannya diperiksa lapisan rute,
 * dan P14 memang menempatkannya di luar kunci ini.
 */
export function bolehDiubahGuru(status: StatusRapor): boolean {
  return status === "draft";
}

/** [PRD.md §9] — rapor baru terlihat Siswa setelah didistribusikan. */
export function terlihatSiswa(status: StatusRapor): boolean {
  return status === "distributed";
}

/**
 * Teks AC-07 **kata demi kata**.
 *
 * Disusun di sini, bukan di frontend, karena CK-API-01 menempatkan seluruh
 * pesan siap-tampil di server: teks yang ditetapkan PRD kata demi kata tidak
 * boleh hidup di dua tempat.
 */
export function pesanMapelBelumLengkap(mapelNama: string): string {
  return `Data Mapel ${mapelNama} belum ada, tolong hubungi guru yang bertanggung jawab.`;
}

export type RincianMapelBelumLengkap = Readonly<{
  mapelNama: string;
  pesan: string;
}>;

export type HasilKelengkapanRapor =
  | Readonly<{ lengkap: true }>
  | Readonly<{
      lengkap: false;
      pesan: string;
      rincian: readonly RincianMapelBelumLengkap[];
    }>;

/**
 * I-20 — finalisasi hanya bila seluruh mata pelajaran lengkap.
 *
 * Masukannya adalah hasil kueri kelengkapan [SCHEMA.md §8.2]: daftar nama mata
 * pelajaran yang masih memiliki sel nilai kosong. Daftar kosong berarti kelas
 * siap difinalisasi. Urutan masukan dipertahankan supaya rincian yang dibaca
 * Wali Kelas selalu sama untuk data yang sama.
 */
export function periksaKelengkapanRapor(
  mapelBelumLengkap: readonly string[],
): HasilKelengkapanRapor {
  if (mapelBelumLengkap.length === 0) {
    return { lengkap: true };
  }

  return {
    lengkap: false,
    pesan: `Rapor belum dapat difinalisasi karena ${mapelBelumLengkap.length} mata pelajaran belum lengkap.`,
    rincian: Object.freeze(
      mapelBelumLengkap.map((mapelNama) =>
        Object.freeze({ mapelNama, pesan: pesanMapelBelumLengkap(mapelNama) }),
      ),
    ),
  };
}

/** Satu komponen di dalam `rapor_mapel.snapshot_komponen` — [RFC-001 §5.5]. */
export type KomponenRapor = Readonly<{
  kode: string;
  nama: string;
  bobot: number;
  nilai: number;
}>;

/** Isi satu baris `rapor_mapel` pada saat finalisasi. */
export type BarisRaporMapel = Readonly<{
  nilaiAkhir: number;
  kehadiranPersen: number;
  snapshotKomponen: readonly KomponenRapor[];
}>;

export type HasilRaporMapel =
  | Readonly<{ sah: true; baris: BarisRaporMapel }>
  | Readonly<{ sah: false; sebab: "komponen_belum_lengkap" | "bobot_tidak_seratus" }>;

export type MasukanRaporMapel = Readonly<{
  komponen: readonly (Komponen & Readonly<{ nama: string }>)[];
  nilai: readonly NilaiKomponen[];
  statusPresensi: readonly StatusPresensi[];
}>;

/**
 * Kehadiran yang dicatat ketika **belum ada satu pun sesi dibuka**.
 *
 * `rapor_mapel.kehadiran_persen` bertipe `NOT NULL`, sehingga keadaan "penyebut
 * nol" tetap harus menghasilkan angka. Nol adalah jawaban yang salah: ia berarti
 * siswa selalu alpa, padahal yang terjadi adalah tidak ada pertemuan yang
 * tercatat. P16 dan AC-29 menyatakan **hanya Alpa** yang mengurangi persentase,
 * dan tanpa sesi tidak ada satu pun Alpa — sehingga angkanya penuh.
 *
 * Pembacaan ini tidak ditetapkan dokumen mana pun secara tersurat; ia dicatat
 * sebagai temuan pada [API.md §13] agar disahkan atau diganti.
 */
export const KEHADIRAN_TANPA_SESI = 100;

/**
 * Menyusun satu baris `rapor_mapel` — salinan **beku** [RFC-001 §5.5].
 *
 * Rapor dibekukan, bukan dihitung ulang: kode, nama, bobot, dan nilai setiap
 * komponen disalin apa adanya pada saat finalisasi, sehingga AC-13 tetap
 * terpenuhi meskipun templat bobot berubah kemudian.
 *
 * Rumusnya tidak ditulis ulang di sini. Nilai akhir memakai `hitungNilaiAkhir`
 * dan kehadiran memakai `hitungPersentaseKehadiran`, keduanya sudah memikul
 * I-17 dan I-18 beserta tesnya.
 */
export function susunRaporMapel(masukan: MasukanRaporMapel): HasilRaporMapel {
  const akhir = hitungNilaiAkhir(
    masukan.komponen.map((satu) => ({ kode: satu.kode, bobot: satu.bobot })),
    masukan.nilai,
  );
  if (!akhir.sah) {
    return { sah: false, sebab: akhir.sebab };
  }

  const nilaiPerKode = new Map(masukan.nilai.map((satu) => [satu.kode, satu.nilai]));
  const snapshotKomponen = masukan.komponen.map((satu) =>
    Object.freeze({
      kode: satu.kode,
      nama: satu.nama,
      bobot: satu.bobot,
      // Kelengkapan sudah dijamin `hitungNilaiAkhir` di atas: tanpa nilai untuk
      // setiap komponen, `akhir.sah` mustahil bernilai true.
      nilai: nilaiPerKode.get(satu.kode)!,
    }),
  );

  const kehadiran = hitungPersentaseKehadiran(masukan.statusPresensi);

  return {
    sah: true,
    baris: Object.freeze({
      nilaiAkhir: akhir.nilaiAkhir,
      kehadiranPersen: kehadiran.adaSesi ? kehadiran.persen : KEHADIRAN_TANPA_SESI,
      snapshotKomponen: Object.freeze(snapshotKomponen),
    }),
  };
}
