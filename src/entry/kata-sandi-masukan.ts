import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

/**
 * Pembacaan kata sandi dari stdin — CK-A-09.
 *
 * Argumen proses terbaca pengguna lain pada mesin yang sama lewat
 * `/proc/<pid>/cmdline`, dan tersimpan pada riwayat shell. Stdin tidak muncul
 * pada keduanya.
 */

/** Panjang kata sandi — API.md §2.7. Tanpa syarat kerumitan (PRD §6.1.3). */
export const PANJANG_MAKSIMUM = 128;

/**
 * Membuang **satu** akhir baris di ujung, dan hanya itu.
 *
 * `echo` menambahkan satu `\n`, `printf '%s'` tidak. Keduanya harus
 * menghasilkan kata sandi yang sama. Yang tidak boleh dilakukan adalah `trim()`
 * menyeluruh: spasi di ujung dapat merupakan bagian kata sandi yang disengaja,
 * dan membuangnya diam-diam menghasilkan akun yang tidak dapat dimasuki dengan
 * kata sandi yang diketik operator.
 */
export function bersihkanKataSandi(mentah: string): string {
  if (mentah.endsWith("\r\n")) return mentah.slice(0, -2);
  if (mentah.endsWith("\n")) return mentah.slice(0, -1);
  return mentah;
}

/** Membaca seluruh isi aliran sebagai UTF-8, lalu membersihkan ujungnya. */
export async function bacaDariAliran(aliran: Readable): Promise<string> {
  const potongan: Buffer[] = [];
  for await (const bagian of aliran) {
    potongan.push(Buffer.from(bagian as Buffer | string));
  }
  return bersihkanKataSandi(Buffer.concat(potongan).toString("utf8"));
}

/**
 * Meminta kata sandi pada terminal **tanpa menampilkan ketikannya**.
 *
 * Gema dimatikan dengan menimpa penulisan readline: tanpa itu kata sandi
 * tampil di layar, dan layar itu kerap dibagikan atau difoto saat pemasangan.
 */
export function tanyaDiTerminal(petunjuk: string): Promise<string> {
  const antarmuka = createInterface({ input: process.stdin, output: process.stdout });

  // Kelas readline tidak mengekspos titik ini pada tipenya; menimpanya adalah
  // cara yang lazim dan satu-satunya tanpa pustaka tambahan.
  (antarmuka as unknown as { _writeToOutput: (teks: string) => void })._writeToOutput = (
    teks: string,
  ) => {
    if (teks.includes(petunjuk)) process.stdout.write(petunjuk);
  };

  return new Promise((selesai) => {
    antarmuka.question(petunjuk, (jawaban) => {
      process.stdout.write("\n");
      antarmuka.close();
      selesai(bersihkanKataSandi(jawaban));
    });
  });
}

/** Dari terminal bila interaktif, dari pipa bila tidak. */
export async function bacaKataSandi(petunjuk: string): Promise<string> {
  return process.stdin.isTTY ? tanyaDiTerminal(petunjuk) : bacaDariAliran(process.stdin);
}
