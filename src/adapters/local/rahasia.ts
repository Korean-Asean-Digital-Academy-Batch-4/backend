import type { PeranBasisData, Rahasia } from "../../ports/rahasia.js";

/**
 * Rahasia dari variabel lingkungan.
 *
 * Dipakai mesin pengembang dan penerapan on-prem, tempat keempat rahasia berada
 * dalam satu berkas `.env` berizin `600` yang dibuat `install.sh` (CK-15,
 * [Techstack.md §7]).
 */

/** Satu variabel per role — [config.ts] memakai nama yang sama. */
const VARIABEL: Readonly<Record<PeranBasisData, string>> = Object.freeze({
  app_rw: "DATABASE_URL",
  app_ro: "DATABASE_URL_RO",
  owner: "DATABASE_URL_MIGRASI",
});

const VARIABEL_KUNCI_AI = "ELICE_API_KEY";

export function rahasiaLingkungan(env: NodeJS.ProcessEnv = process.env): Rahasia {
  return {
    async urlBasisData(peran) {
      return wajibAda(env[VARIABEL[peran]], VARIABEL[peran]);
    },

    async kunciApiAi() {
      return wajibAda(env[VARIABEL_KUNCI_AI], VARIABEL_KUNCI_AI);
    },
  };
}

/**
 * Menyebut nama variabelnya, bukan sekadar gagal.
 *
 * Kegagalan ini muncul pada saat container menyala, dan yang membacanya
 * biasanya sedang memasang sistem untuk pertama kali.
 */
function wajibAda(nilai: string | undefined, nama: string): string {
  if (!nilai) {
    throw new Error(`Rahasia belum disetel: variabel lingkungan ${nama} kosong.`);
  }
  return nilai;
}
