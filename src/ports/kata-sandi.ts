/**
 * Port kredensial. Menyembunyikan pilihan algoritma dari lapisan rute.
 *
 * [Techstack.md §5] menetapkan Argon2id, dan [ARCHITECTURE.md §5.1] menempatkan
 * pustaka yang bersangkutan di `adapters/`. Rute hanya mengenal antarmuka ini,
 * sehingga penggantian algoritma kelak tidak menyentuh satu pun berkas rute.
 */
export interface KataSandi {
  /** Menghasilkan kata sandi awal acak yang hanya diserahkan sekali. */
  buatAwal(): string;

  /** Menghasilkan hash Argon2id beserta garamnya. */
  hash(polos: string): Promise<string>;

  /** Memeriksa kata sandi terhadap hash. Hash yang rusak dijawab `false`, bukan galat. */
  verifikasi(hash: string, polos: string): Promise<boolean>;

  /**
   * Verifikasi terhadap hash tiruan, selalu `false`.
   *
   * Dipakai ketika nama penggunanya tidak ada, supaya lama jawaban permintaan
   * yang gagal tidak membedakan akun yang ada dari akun yang tidak ada.
   */
  verifikasiTiruan(polos: string): Promise<boolean>;
}
