import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  pastikanKunciSah,
  type PenyimpananBerkas,
  type TautanBerkas,
} from "../../ports/penyimpanan-berkas.js";

/**
 * Penyimpanan berkas rapor di atas S3 — [ARCHITECTURE.md §11.1].
 *
 * Bucketnya privat dan tidak dapat dihubungi siapa pun secara langsung; yang
 * diterbitkan hanyalah tautan bertanda tangan berumur pendek, sehingga isi
 * berkas tidak pernah melewati proses aplikasi.
 *
 * **S3 dihubungi lewat gateway endpoint yang tidak berbiaya** ([ARCHITECTURE.md
 * §2]), sehingga unggah dan unduh berkas rapor tidak melewati NAT. Itu urusan
 * jaringan, bukan urusan kode di sini — yang penting bagi berkas ini adalah
 * tidak ada satu pun pengaturan endpoint yang ditulis tangan.
 */

/** Ketiadaan objek dilaporkan S3 dengan beberapa nama sekaligus. */
const GALAT_TIDAK_ADA = new Set(["NotFound", "NoSuchKey"]);

export type PilihanPenyimpananS3 = Readonly<{
  bucket: string;
  /**
   * Region. Diteruskan sebagai teks, bukan sebagai klien yang sudah jadi:
   * pemanggilnya berada di `entry/`, dan `entry/` tidak boleh mengimpor SDK AWS
   * ([AGENTS.md §3.2] larangan 6).
   */
  wilayah?: string;
  /** Disuntikkan pada pengujian. */
  klien?: S3Client;
  sekarang?: () => Date;
}>;

export function penyimpananBerkasS3(pilihan: PilihanPenyimpananS3): PenyimpananBerkas {
  const klien = pilihan.klien ?? new S3Client(pilihan.wilayah ? { region: pilihan.wilayah } : {});
  const sekarang = pilihan.sekarang ?? (() => new Date());

  return {
    async simpan(kunci, isi, jenisIsi) {
      await klien.send(
        new PutObjectCommand({
          Bucket: pilihan.bucket,
          Key: pastikanKunciSah(kunci),
          Body: isi,
          ContentType: jenisIsi,
        }),
      );
    },

    async ada(kunci) {
      try {
        await klien.send(
          new HeadObjectCommand({ Bucket: pilihan.bucket, Key: pastikanKunciSah(kunci) }),
        );
        return true;
      } catch (galat) {
        // Izin yang kurang **bukan** berkas yang tidak ada. Menyamakan keduanya
        // menghasilkan render ulang tanpa henti yang selalu gagal menyimpan,
        // dengan gejala berupa unduhan lambat alih-alih galat yang jelas.
        if (tidakAda(galat)) return false;
        throw galat;
      }
    },

    async baca(kunci) {
      try {
        const keluaran = await klien.send(
          new GetObjectCommand({ Bucket: pilihan.bucket, Key: pastikanKunciSah(kunci) }),
        );
        if (!keluaran.Body) return undefined;
        return Buffer.from(await keluaran.Body.transformToByteArray());
      } catch (galat) {
        if (tidakAda(galat)) return undefined;
        throw galat;
      }
    },

    async hapus(kunci) {
      try {
        await klien.send(
          new DeleteObjectCommand({ Bucket: pilihan.bucket, Key: pastikanKunciSah(kunci) }),
        );
      } catch (galat) {
        // Berkas yang memang tidak ada bukan kegagalan — penghapusan CK-A-05
        // dijalankan tanpa memeriksa keberadaannya lebih dulu.
        if (tidakAda(galat)) return;
        throw galat;
      }
    },

    async tautan(kunci, umurDetik): Promise<TautanBerkas> {
      // Penandatanganan berlangsung setempat: tidak ada panggilan ke S3, dan
      // karenanya tidak ada pemeriksaan keberadaan. Pemanggil sudah memastikan
      // berkasnya ada lebih dulu ([API.md §8.4], `db/rapor/berkas.ts`).
      const url = await getSignedUrl(
        klien,
        new GetObjectCommand({ Bucket: pilihan.bucket, Key: pastikanKunciSah(kunci) }),
        { expiresIn: umurDetik },
      );

      return Object.freeze({
        url,
        kedaluwarsaPada: new Date(sekarang().getTime() + umurDetik * 1000),
      });
    },
  };
}

function tidakAda(galat: unknown): boolean {
  if (!(galat instanceof Error)) return false;
  const status = (galat as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return GALAT_TIDAK_ADA.has(galat.name) || status === 404;
}
