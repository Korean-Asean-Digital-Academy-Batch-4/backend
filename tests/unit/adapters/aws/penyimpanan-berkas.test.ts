import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { penyimpananBerkasS3 } from "../../../../src/adapters/aws/penyimpanan-berkas.js";

const tiruan = mockClient(S3Client);

const BUCKET = "edutrack-rapor";
const SEKARANG = new Date("2026-08-11T09:00:00.000Z");

function buatPenyimpanan() {
  return penyimpananBerkasS3({
    bucket: BUCKET,
    klien: new S3Client({
      region: "ap-southeast-3",
      credentials: { accessKeyId: "AKIAUJI", secretAccessKey: "rahasia-uji" },
    }),
    sekarang: () => SEKARANG,
  });
}

function aliran(isi: string) {
  return sdkStreamMixin(Readable.from([Buffer.from(isi)]));
}

/** Bentuk galat S3 ketika objeknya tidak ada. */
function galatS3(nama: string, status: number) {
  const galat = new Error(nama);
  galat.name = nama;
  Object.assign(galat, { $metadata: { httpStatusCode: status } });
  return galat;
}

beforeEach(() => {
  tiruan.reset();
});

describe("penyimpananBerkasS3.simpan", () => {
  it("menaruh objek beserta jenis isinya", async () => {
    tiruan.on(PutObjectCommand).resolves({});

    await buatPenyimpanan().simpan("rapor/2026/a.pdf", Buffer.from("isi"), "application/pdf");

    const permintaan = tiruan.commandCalls(PutObjectCommand)[0]?.args[0]?.input;
    expect(permintaan).toMatchObject({
      Bucket: BUCKET,
      Key: "rapor/2026/a.pdf",
      ContentType: "application/pdf",
    });
  });

  it("menolak kunci yang mencoba keluar dari awalannya", async () => {
    await expect(
      buatPenyimpanan().simpan("../rahasia", Buffer.from("isi"), "application/pdf"),
    ).rejects.toThrow(/tidak sah/);

    expect(tiruan.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});

describe("penyimpananBerkasS3.ada", () => {
  it("menjawab benar ketika objeknya ada", async () => {
    tiruan.on(HeadObjectCommand).resolves({ ContentLength: 3 });

    await expect(buatPenyimpanan().ada("rapor/a.pdf")).resolves.toBe(true);
  });

  it("menjawab salah ketika objeknya tidak ada, bukan melempar", async () => {
    tiruan.on(HeadObjectCommand).rejects(galatS3("NotFound", 404));

    await expect(buatPenyimpanan().ada("rapor/a.pdf")).resolves.toBe(false);
  });

  it("meneruskan galat selain ketiadaan — izin yang kurang bukan berkas yang tidak ada", async () => {
    tiruan.on(HeadObjectCommand).rejects(galatS3("AccessDenied", 403));

    await expect(buatPenyimpanan().ada("rapor/a.pdf")).rejects.toThrow(/AccessDenied/);
  });
});

describe("penyimpananBerkasS3.baca", () => {
  it("mengembalikan isi objek sebagai Buffer", async () => {
    tiruan.on(GetObjectCommand).resolves({ Body: aliran("halo") });

    await expect(buatPenyimpanan().baca("rapor/a.pdf")).resolves.toEqual(Buffer.from("halo"));
  });

  it("mengembalikan undefined ketika objeknya tidak ada", async () => {
    tiruan.on(GetObjectCommand).rejects(galatS3("NoSuchKey", 404));

    await expect(buatPenyimpanan().baca("rapor/a.pdf")).resolves.toBeUndefined();
  });
});

describe("penyimpananBerkasS3.hapus", () => {
  it("menghapus objek", async () => {
    tiruan.on(DeleteObjectCommand).resolves({});

    await buatPenyimpanan().hapus("rapor/a.pdf");

    expect(tiruan.commandCalls(DeleteObjectCommand)[0]?.args[0]?.input).toMatchObject({
      Bucket: BUCKET,
      Key: "rapor/a.pdf",
    });
  });

  it("tidak menganggap berkas yang memang tidak ada sebagai kegagalan (CK-A-05)", async () => {
    tiruan.on(DeleteObjectCommand).rejects(galatS3("NoSuchKey", 404));

    await expect(buatPenyimpanan().hapus("rapor/a.pdf")).resolves.toBeUndefined();
  });
});

describe("penyimpananBerkasS3.tautan", () => {
  it("menerbitkan tautan bertanda tangan beserta batas berlakunya", async () => {
    const tautan = await buatPenyimpanan().tautan("rapor/a.pdf", 300);

    const alamat = new URL(tautan.url);
    expect(alamat.protocol).toBe("https:");
    expect(alamat.pathname).toContain("rapor/a.pdf");
    expect(alamat.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(alamat.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(tautan.kedaluwarsaPada).toEqual(new Date(SEKARANG.getTime() + 300_000));
  });

  it("tidak pernah memanggil S3 — penandatanganan berlangsung setempat", async () => {
    await buatPenyimpanan().tautan("rapor/a.pdf", 300);

    expect(tiruan.calls()).toHaveLength(0);
  });
});
