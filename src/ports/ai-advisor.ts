/**
 * Port layanan AI — tombol Suggestion, [ARCHITECTURE.md Pasal 10].
 *
 * Lapisan domain dan rute tidak mengetahui penyedia mana yang dipakai.
 * Implementasinya berada di `adapters/openai-compatible/`, dinamai menurut
 * **protokol** dan bukan menurut penyedia (CK-A-02): berpindah penyedia, atau
 * berpindah ke model yang dipasang sendiri di server sekolah, berarti mengganti
 * base URL dan kunci API tanpa menyentuh nama direktori maupun isi adapter.
 *
 * **Konteks yang dikirim tidak pernah memuat identitas.** Bukan karena penyusun
 * prompt berdisiplin, melainkan karena koneksi `app_ro` yang membacanya tidak
 * memiliki hak baca atas `pengguna`, `guru`, maupun `siswa` sama sekali
 * ([SCHEMA.md §7.1]). Tipe di bawah karenanya tidak memiliki tempat untuk nama
 * maupun NIS — bahkan bila ada yang hendak menyertakannya.
 */

/** Satu komponen penilaian sebagaimana dibaca jalur AI. */
export type KomponenKonteks = Readonly<{
  kode: string;
  nama: string;
  bobot: number;
  /** `null` berarti belum diisi — I-12. Bukan nol. */
  nilai: number | null;
  topik: string | null;
}>;

/** Satu mata pelajaran beserta capaian siswa yang menekan tombol. */
export type MapelKonteks = Readonly<{
  nama: string;
  kkm: number;
  lengkap: boolean;
  /** `null` selama komponennya belum lengkap — [PRD §8.6] butir 5. */
  nilaiAkhir: number | null;
  /** `null` bila belum ada satu pun sesi presensi dibuka pada mata pelajaran ini. */
  kehadiranPersen: number | null;
  komponen: readonly KomponenKonteks[];
}>;

/** Seluruh bahan penyusun prompt. Tanpa nama, tanpa NIS, tanpa pengenal apa pun. */
export type KonteksSaran = Readonly<{
  periodeNama: string;
  mapel: readonly MapelKonteks[];
}>;

export type SebabGagalAi = "batas_waktu" | "layanan_gagal" | "jawaban_terpotong";

export type HasilSaran =
  Readonly<{ berhasil: true; teks: string }> | Readonly<{ berhasil: false; sebab: SebabGagalAi }>;

/**
 * Batas waktu satu panggilan: **20 detik** — [ARCHITECTURE.md Pasal 10].
 *
 * Menahan permintaan yang menggantung. Batas waktu fungsi sendiri 30 detik,
 * sehingga sisa sepuluh detik cukup untuk menyusun jawaban gagal yang rapi.
 */
export const BATAS_WAKTU_AI_MS = 20_000;

export interface AiAdvisor {
  /**
   * Menyusun satu rekomendasi. Sekali jalan, tanpa percakapan lanjutan
   * ([PRD §8.5]).
   *
   * Kegagalan **tidak dilemparkan** melainkan dikembalikan sebagai nilai:
   * AC-21 menuntut kegagalan layanan AI ditangani sebagai kegagalan lunak yang
   * tidak menghambat apa pun.
   */
  sarankan(konteks: KonteksSaran): Promise<HasilSaran>;
}
