import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  pastikanKunciSah,
  type PenyimpananBerkas,
  type TautanBerkas,
} from "../../ports/penyimpanan-berkas.js";

/**
 * Penyimpanan berkas di atas disk lokal.
 *
 * Dipakai mesin pengembang, uji, dan penerapan on-prem — [ARCHITECTURE.md §13]
 * mencatat penyimpanan berkas sebagai bagian yang boleh ditukar ke MinIO maupun
 * disk lokal. Penerapan AWS memakai adapter tersendiri di `adapters/aws/`, yang
 * belum ditulis karena Jalur A tidak menyentuh AWS ([AGENTS.md §8.1]).
 *
 * **Tautannya `file://`, dan itu memang bukan tautan bertanda tangan.** Disk
 * lokal tidak memiliki mekanisme penandatanganan; yang ditiru di sini hanyalah
 * bentuk kontrak portnya, yaitu satu URL beserta batas berlakunya. Umur tautan
 * lima menit pada [ARCHITECTURE.md §11.1] baru berlaku sesungguhnya setelah
 * adapter S3 terpasang.
 */

const KODE_TIDAK_ADA = "ENOENT";

export function penyimpananBerkasLokal(
  akar: string,
  sekarang: () => Date = () => new Date(),
): PenyimpananBerkas {
  const akarMutlak = resolve(akar);

  function jalanBerkas(kunci: string): string {
    const jalan = resolve(join(akarMutlak, pastikanKunciSah(kunci)));
    // Lapis kedua. Pola pada port sudah menutup jalan keluar, tetapi pemeriksaan
    // hasil resolusi tidak bergantung pada ketepatan pola mana pun.
    if (jalan !== akarMutlak && !jalan.startsWith(akarMutlak + sep)) {
      throw new Error(`Kunci berkas tidak sah: ${JSON.stringify(kunci)}`);
    }
    return jalan;
  }

  return {
    async simpan(kunci, isi, _jenisIsi) {
      const jalan = jalanBerkas(kunci);
      await mkdir(dirname(jalan), { recursive: true });
      await writeFile(jalan, isi);
    },

    async ada(kunci) {
      return (await bacaAman(jalanBerkas(kunci))) !== undefined;
    },

    async baca(kunci) {
      return bacaAman(jalanBerkas(kunci));
    },

    async hapus(kunci) {
      // `force` menjadikan berkas yang memang tidak ada bukan kegagalan —
      // penghapusan CK-A-05 dijalankan tanpa memeriksa keberadaannya lebih dulu.
      await rm(jalanBerkas(kunci), { force: true });
    },

    async tautan(kunci, umurDetik): Promise<TautanBerkas> {
      const jalan = jalanBerkas(kunci);
      if ((await bacaAman(jalan)) === undefined) {
        throw new Error(`Berkas tidak ditemukan: ${kunci}`);
      }
      return Object.freeze({
        url: pathToFileURL(jalan).toString(),
        kedaluwarsaPada: new Date(sekarang().getTime() + umurDetik * 1000),
      });
    },
  };
}

/** Membaca berkas; ketiadaannya dijawab `undefined`, galat lain tetap dilempar. */
async function bacaAman(jalan: string): Promise<Buffer | undefined> {
  try {
    return await readFile(jalan);
  } catch (galat) {
    if ((galat as NodeJS.ErrnoException).code === KODE_TIDAK_ADA) {
      return undefined;
    }
    throw galat;
  }
}
