import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { z } from "zod";

import type { PeranBasisData, Rahasia } from "../../ports/rahasia.js";

/**
 * Rahasia dari Secrets Manager dan SSM Parameter Store — [ARCHITECTURE.md §12.1].
 *
 * Dua layanan, bukan satu, dan pembedaannya mengikuti akibat kebocoran
 * ([Techstack.md §7]): kredensial basis data di Secrets Manager karena
 * dirotasi terjadwal, kunci Elice di SSM tier Standard karena akibat
 * kebocorannya paling ringan dan tempatnya tidak berbiaya.
 *
 * **Isi rahasia tidak pernah masuk ke pesan galat.** Kegagalan di sini
 * dilaporkan dengan menyebut peran dan rujukannya saja; pesan galat adalah
 * jalur tercepat sebuah kata sandi sampai ke CloudWatch Logs.
 */

/** Bentuk nilai baku RDS — CK-D-05. */
const skemaKredensial = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type PilihanRahasiaAws = Readonly<{
  /** Alamat instance RDS. Bukan rahasia, sehingga datang dari variabel lingkungan. */
  inang: string;
  porta: number;
  basisData: string;
  /**
   * Nama atau ARN rahasia per role. Sebagian boleh kosong: fungsi `migrate`
   * hanya memperoleh rujukan `owner`, dan fungsi `api` tidak pernah
   * memperolehnya sama sekali ([DEPLOYMENT.md §9.5]).
   */
  rujukan: Readonly<Partial<Record<PeranBasisData, string>>>;
  parameterKunciAi?: string;
  /**
   * Region. Diteruskan sebagai teks, bukan sebagai klien yang sudah jadi:
   * pemanggilnya berada di `entry/`, dan `entry/` tidak boleh mengimpor SDK AWS
   * ([AGENTS.md §3.2] larangan 6). Penyusunan kliennya urusan berkas ini.
   */
  wilayah?: string;
  /** Disuntikkan pada pengujian, menggantikan kedua klien di atas. */
  klienRahasia?: SecretsManagerClient;
  klienParameter?: SSMClient;
}>;

export function rahasiaAws(pilihan: PilihanRahasiaAws): Rahasia {
  const wilayah = pilihan.wilayah;
  const klienRahasia =
    pilihan.klienRahasia ?? new SecretsManagerClient(wilayah ? { region: wilayah } : {});
  const klienParameter =
    pilihan.klienParameter ?? new SSMClient(wilayah ? { region: wilayah } : {});

  return {
    async urlBasisData(peran) {
      const rujukan = pilihan.rujukan[peran];
      if (!rujukan) {
        throw new Error(
          `Rujukan rahasia untuk role ${peran} belum disetel: variabel lingkungan ${VARIABEL_RUJUKAN[peran]} kosong.`,
        );
      }

      const keluaran = await klienRahasia.send(new GetSecretValueCommand({ SecretId: rujukan }));
      const kredensial = uraikanKredensial(keluaran.SecretString, peran);

      return susunUrl(kredensial, pilihan);
    },

    async kunciApiAi() {
      const nama = pilihan.parameterKunciAi;
      if (!nama) {
        throw new Error(
          `Nama parameter kunci AI belum disetel: variabel lingkungan ${VARIABEL_PARAMETER_KUNCI_AI} kosong.`,
        );
      }

      const keluaran = await klienParameter.send(
        new GetParameterCommand({ Name: nama, WithDecryption: true }),
      );
      const nilai = keluaran.Parameter?.Value;
      if (!nilai) {
        throw new Error(`Parameter ${nama} tidak memiliki nilai.`);
      }
      return nilai;
    },
  };
}

/** Nama variabel lingkungannya, dipakai pesan galat — sejalan `entry/lingkungan.ts`. */
const VARIABEL_RUJUKAN: Readonly<Record<PeranBasisData, string>> = Object.freeze({
  app_rw: "RAHASIA_APP_RW",
  app_ro: "RAHASIA_APP_RO",
  owner: "RAHASIA_OWNER",
});

const VARIABEL_PARAMETER_KUNCI_AI = "PARAMETER_KUNCI_AI";

function uraikanKredensial(isi: string | undefined, peran: PeranBasisData) {
  if (!isi) {
    throw new Error(`Rahasia role ${peran} tidak memiliki SecretString.`);
  }

  let mentah: unknown;
  try {
    mentah = JSON.parse(isi);
  } catch {
    // Isinya sengaja tidak disertakan — ia adalah kata sandi.
    throw new Error(`Rahasia role ${peran} bukan JSON {username, password} — CK-D-05.`);
  }

  const hasil = skemaKredensial.safeParse(mentah);
  if (!hasil.success) {
    throw new Error(`Rahasia role ${peran} bukan JSON {username, password} — CK-D-05.`);
  }
  return hasil.data;
}

/**
 * `sslmode=verify-full` — CK-A-13.
 *
 * **Dipatok, bukan dibiarkan `require`.** `pg-connection-string` hari ini
 * memperlakukan `require` sebagai `verify-full`, tetapi memperingatkan bahwa
 * pada `pg` v9 artinya akan **melemah** mengikuti libpq, yaitu tanpa verifikasi
 * sertifikat. Konfigurasi yang bersandar pada arti lama akan kehilangan
 * verifikasinya pada peningkatan pustaka, tanpa satu pun gejala.
 *
 * Sertifikat RDS diverifikasi terhadap bundel CA Amazon RDS di dalam image,
 * yang dipercaya lewat `NODE_EXTRA_CA_CERTS`. Tanpa itu, koneksinya ditolak
 * dengan `self-signed certificate in certificate chain`.
 *
 * Nama pengguna dan kata sandinya disandikan persen: kata sandi acak yang
 * memuat `@`, `/`, atau `:` akan mengubah arti URL-nya apabila ditempel apa
 * adanya, dan kegagalannya berupa host yang salah alih-alih galat yang jelas.
 */
function susunUrl(
  kredensial: { username: string; password: string },
  pilihan: PilihanRahasiaAws,
): string {
  const pengguna = encodeURIComponent(kredensial.username);
  const sandi = encodeURIComponent(kredensial.password);
  return `postgresql://${pengguna}:${sandi}@${pilihan.inang}:${pilihan.porta}/${pilihan.basisData}?sslmode=verify-full`;
}
