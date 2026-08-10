import type { KataSandi } from "../../ports/kata-sandi.js";

/** Batas Argon2 paralel agar unggah maksimum tidak menghabiskan memori proses. */
export const KONKURENSI_HASH_UNGGAH = 4;

/**
 * Menghash larik kata sandi dengan tepat empat worker, bukan 360 promise.
 * Posisi keluaran tetap sama dengan masukan walaupun pekerjaan selesai di luar urutan.
 */
export async function hashKataSandiTerbatas(
  kataSandi: Pick<KataSandi, "hash">,
  kataSandiAwal: readonly string[],
): Promise<readonly string[]> {
  const hasil = new Array<string>(kataSandiAwal.length);
  let indeksBerikutnya = 0;
  let gagal = false;
  let kegagalan: unknown;

  const pekerja = async (): Promise<void> => {
    while (!gagal) {
      const indeks = indeksBerikutnya;
      indeksBerikutnya += 1;
      if (indeks >= kataSandiAwal.length) return;

      try {
        hasil[indeks] = await kataSandi.hash(kataSandiAwal[indeks]!);
      } catch (galat) {
        gagal = true;
        kegagalan = galat;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(KONKURENSI_HASH_UNGGAH, kataSandiAwal.length) }, pekerja),
  );
  if (gagal) throw kegagalan;
  return Object.freeze([...hasil]);
}
