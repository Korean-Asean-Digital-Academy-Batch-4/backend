/**
 * Transisi status rapor. Tanpa I/O, tanpa basis data.
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
