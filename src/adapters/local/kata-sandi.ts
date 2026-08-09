import { randomInt } from "node:crypto";

import { hash, verify, type Algorithm } from "@node-rs/argon2";

import type { KataSandi } from "../../ports/kata-sandi.js";

/**
 * Argon2id lewat `@node-rs/argon2`. Techstack.md §5.
 *
 * Dipilih di atas `argon2` karena membawa binary prebuilt bagi `linux-*-gnu`
 * dan `darwin-arm64`, sehingga image produksi tidak memerlukan perkakas
 * kompilasi dan `npm ci --omit=dev` tetap ringkas.
 */

// Argon2id, yaitu nilai 2 pada enum `Algorithm`. Ditulis sebagai angka karena
// `verbatimModuleSyntax` melarang pengaksesan ambient const enum, dan enum itu
// memang ambient pada `@node-rs/argon2`. Nilainya diverifikasi: hash yang
// dihasilkan berawalan `$argon2id$`, bukan `$argon2i$` maupun `$argon2d$`.
const ARGON2ID = 2 as Algorithm;

const PILIHAN = { algorithm: ARGON2ID } as const;

/**
 * Hash tiruan bagi nama pengguna yang tidak ada.
 *
 * Tanpa ini, permintaan atas akun yang tidak ada dijawab seketika sedangkan
 * akun yang ada dijawab sesudah satu verifikasi Argon2id — selisih yang cukup
 * untuk membedakan keduanya dari luar, dan dengan demikian mengungkapkan akun
 * mana yang terdaftar. API.md §3.1 menuntut keberadaan akun tidak terungkap.
 *
 * Nilainya hash Argon2id atas string acak yang dibuang, sehingga tidak ada
 * kata sandi yang dapat mencocokkannya.
 */
let hashTiruan: Promise<string> | undefined;

function tiruan(): Promise<string> {
  hashTiruan ??= hash(buatKataSandiAwal(), PILIHAN);
  return hashTiruan;
}

/** Panjang kata sandi awal yang dihasilkan sistem — PRD §6.1.3, P17. */
export const PANJANG_KATA_SANDI_AWAL = 12;

/**
 * Aksara tanpa `0`, `O`, `1`, `l`, dan `I`.
 *
 * Kata sandi awal dibacakan Administrator kepada pengguna, sehingga pasangan
 * aksara yang rancu saat dibaca menghasilkan panggilan telepon, bukan keamanan.
 */
const AKSARA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * Kata sandi awal acak.
 *
 * Memakai `randomInt` dari `node:crypto`, bukan `Math.random`: yang terakhir
 * tidak aman secara kriptografis dan dapat diramalkan dari keluaran sebelumnya.
 * `randomInt` juga bebas dari bias modulo yang muncul bila `%` dipakai atas
 * bilangan acak.
 */
export function buatKataSandiAwal(): string {
  let hasil = "";
  for (let i = 0; i < PANJANG_KATA_SANDI_AWAL; i += 1) {
    hasil += AKSARA[randomInt(AKSARA.length)];
  }
  return hasil;
}

export function kataSandiArgon2id(): KataSandi {
  // Dipanaskan sejak adapter dibuat. Tanpa ini, permintaan PERTAMA atas akun
  // yang tidak ada sesudah setiap cold start menanggung satu hash Argon2id
  // tambahan di atas verifikasinya — selisih waktu yang, meskipun sempit,
  // justru merupakan hal yang hendak dihapus verifikasiTiruan.
  void tiruan();

  return {
    hash: (polos) => hash(polos, PILIHAN),

    // Hash yang rusak, kosong, atau berformat lain dijawab `false`. Melempar
    // galat di sini akan menjadi 500 pada jalur masuk, dan membedakan baris
    // pengguna yang hash-nya rusak dari yang kata sandinya salah.
    verifikasi: async (tersimpan, polos) => {
      try {
        return await verify(tersimpan, polos, PILIHAN);
      } catch {
        return false;
      }
    },

    verifikasiTiruan: async (polos) => {
      try {
        return await verify(await tiruan(), polos, PILIHAN);
      } catch {
        return false;
      }
    },
  };
}
