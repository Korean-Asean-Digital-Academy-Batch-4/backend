import { z } from "zod";

import { penyimpananBerkasS3 } from "../adapters/aws/penyimpanan-berkas.js";
import { rahasiaAws } from "../adapters/aws/rahasia.js";
import { penyimpananBerkasLokal } from "../adapters/local/penyimpanan-berkas.js";
import { rahasiaLingkungan } from "../adapters/local/rahasia.js";
import type { PenyimpananBerkas } from "../ports/penyimpanan-berkas.js";
import type { Rahasia } from "../ports/rahasia.js";

/**
 * Pemilihan adapter — satu-satunya tempat kedua lingkungan bertemu.
 *
 * [ARCHITECTURE.md Pasal 13] menjanjikan **satu image, dua lingkungan**: image
 * yang sama berjalan di Lambda dan di server sekolah, dan tidak ada satu pun
 * lapisan abstraksi yang dibangun khusus demi portabilitas. Yang membuat janji
 * itu dapat ditepati adalah pemilihan di bawah — ia berada di `entry/`, yaitu
 * satu-satunya lapisan yang boleh mengenal `adapters/` ([ARCHITECTURE.md §5.1]).
 *
 * **Satu variabel yang menentukan, bukan penyimpulan.** `LINGKUNGAN` disetel
 * terang-terangan alih-alih disimpulkan dari keberadaan `AWS_LAMBDA_*` atau
 * sejenisnya: penyimpulan bekerja sampai ia keliru, dan kekeliruannya berupa
 * proses yang mencari Secrets Manager di jaringan sekolah lalu menggantung
 * sampai batas waktu.
 */

export type NamaLingkungan = "lokal" | "aws";

export type Lingkungan = Readonly<{
  nama: NamaLingkungan;
  rahasia: Rahasia;
  penyimpanan: PenyimpananBerkas;
}>;

/** Fungsi `migrate` tidak menyentuh penyimpanan berkas maupun jalur AI. */
export type LingkunganMigrasi = Readonly<{
  nama: NamaLingkungan;
  rahasia: Rahasia;
}>;

const NAMA_SAH: readonly NamaLingkungan[] = ["lokal", "aws"];

const skemaAws = z.object({
  AWS_REGION: z.string().min(1, "AWS_REGION wajib diisi"),
  /** Alamat instance RDS. Bukan rahasia — [DEPLOYMENT.md §5.1]. */
  DB_INANG: z.string().min(1, "DB_INANG wajib diisi"),
  DB_PORTA: z.coerce.number().int().positive().default(5432),
  DB_NAMA: z.string().min(1, "DB_NAMA wajib diisi"),
  /**
   * Rujukan rahasia bersifat opsional di sini, dan itu disengaja: kedua fungsi
   * memakai image yang sama tetapi memperoleh rujukan yang berbeda. Fungsi
   * `api` tidak pernah menerima `RAHASIA_OWNER`, dan fungsi `migrate` tidak
   * pernah menerima kedua rujukan lainnya ([DEPLOYMENT.md §9.5]). Ketiadaannya
   * baru menjadi galat ketika perannya benar-benar diminta.
   */
  RAHASIA_APP_RW: z.string().min(1).optional(),
  RAHASIA_APP_RO: z.string().min(1).optional(),
  RAHASIA_OWNER: z.string().min(1).optional(),
  PARAMETER_KUNCI_AI: z.string().min(1).optional(),
});

const skemaBucket = z.object({
  BUCKET_RAPOR: z.string().min(1, "BUCKET_RAPOR wajib diisi"),
});

const skemaBerkasAkar = z.object({
  BERKAS_AKAR: z.string().min(1).default("./data/berkas"),
});

export function pilihLingkungan(env: NodeJS.ProcessEnv = process.env): Lingkungan {
  const nama = bacaNama(env);

  if (nama === "lokal") {
    return Object.freeze({
      nama,
      rahasia: rahasiaLingkungan(env),
      penyimpanan: penyimpananBerkasLokal(skemaBerkasAkar.parse(env).BERKAS_AKAR),
    });
  }

  const tetapan = skemaAws.parse(env);
  const { BUCKET_RAPOR } = skemaBucket.parse(env);

  return Object.freeze({
    nama,
    rahasia: rahasiaAwsDari(tetapan),
    penyimpanan: penyimpananBerkasS3({ bucket: BUCKET_RAPOR, wilayah: tetapan.AWS_REGION }),
  });
}

export function pilihLingkunganMigrasi(env: NodeJS.ProcessEnv = process.env): LingkunganMigrasi {
  const nama = bacaNama(env);

  if (nama === "lokal") {
    return Object.freeze({ nama, rahasia: rahasiaLingkungan(env) });
  }

  return Object.freeze({ nama, rahasia: rahasiaAwsDari(skemaAws.parse(env)) });
}

function bacaNama(env: NodeJS.ProcessEnv): NamaLingkungan {
  const nilai = env.LINGKUNGAN ?? "lokal";
  if (!NAMA_SAH.includes(nilai as NamaLingkungan)) {
    throw new Error(
      `LINGKUNGAN tidak dikenal: ${JSON.stringify(nilai)}. Nilai yang sah: lokal, aws.`,
    );
  }
  return nilai as NamaLingkungan;
}

function rahasiaAwsDari(tetapan: z.infer<typeof skemaAws>): Rahasia {
  return rahasiaAws({
    inang: tetapan.DB_INANG,
    porta: tetapan.DB_PORTA,
    basisData: tetapan.DB_NAMA,
    rujukan: {
      app_rw: tetapan.RAHASIA_APP_RW,
      app_ro: tetapan.RAHASIA_APP_RO,
      owner: tetapan.RAHASIA_OWNER,
    },
    parameterKunciAi: tetapan.PARAMETER_KUNCI_AI,
    // Region diteruskan sebagai teks. `entry/` tidak boleh mengimpor SDK AWS
    // — AGENTS.md §3.2 larangan 6, dan itu ditegakkan eslint.
    wilayah: tetapan.AWS_REGION,
  });
}
