import { describe, expect, it } from "vitest";

import { pilihLingkungan, pilihLingkunganMigrasi } from "../../../src/entry/lingkungan.js";

const LOKAL = {
  DATABASE_URL: "postgres://rw@lokal/edutrack",
  DATABASE_URL_RO: "postgres://ro@lokal/edutrack",
  DATABASE_URL_MIGRASI: "postgres://owner@lokal/edutrack",
  ELICE_API_KEY: "kunci-uji",
  BERKAS_AKAR: "./data/berkas",
};

const AWS = {
  LINGKUNGAN: "aws",
  AWS_REGION: "ap-southeast-3",
  DB_INANG: "edutrack.abc.ap-southeast-3.rds.amazonaws.com",
  DB_NAMA: "edutrack",
  RAHASIA_APP_RW: "edutrack/db/app_rw",
  RAHASIA_APP_RO: "edutrack/db/app_ro",
  PARAMETER_KUNCI_AI: "/edutrack/ai/elice-api-key",
  BUCKET_RAPOR: "edutrack-rapor",
};

describe("pilihLingkungan", () => {
  it("memilih lingkungan lokal ketika LINGKUNGAN tidak disetel", () => {
    expect(pilihLingkungan(LOKAL).nama).toBe("lokal");
  });

  it("membaca rahasia dari variabel lingkungan pada lingkungan lokal", async () => {
    const lingkungan = pilihLingkungan({ ...LOKAL, LINGKUNGAN: "lokal" });

    await expect(lingkungan.rahasia.urlBasisData("app_rw")).resolves.toBe(LOKAL.DATABASE_URL);
  });

  it("memilih lingkungan AWS ketika seluruh tetapannya lengkap", () => {
    expect(pilihLingkungan(AWS).nama).toBe("aws");
  });

  it("menolak nilai LINGKUNGAN yang tidak dikenal, dan menyebut nilai yang sah", () => {
    expect(() => pilihLingkungan({ ...LOKAL, LINGKUNGAN: "produksi" })).toThrow(/lokal|aws/);
  });

  it("menolak lingkungan AWS tanpa alamat basis data, dan menyebut variabelnya", () => {
    expect(() => pilihLingkungan({ ...AWS, DB_INANG: undefined })).toThrow(/DB_INANG/);
  });

  it("menolak lingkungan AWS tanpa bucket rapor — jalur rapor tidak dapat menyala tanpanya", () => {
    expect(() => pilihLingkungan({ ...AWS, BUCKET_RAPOR: undefined })).toThrow(/BUCKET_RAPOR/);
  });

  it("menolak rujukan rahasia yang tidak disetel pada saat perannya dipakai", async () => {
    const lingkungan = pilihLingkungan({ ...AWS, RAHASIA_APP_RO: undefined });

    await expect(lingkungan.rahasia.urlBasisData("app_ro")).rejects.toThrow(/RAHASIA_APP_RO/);
  });
});

describe("pilihLingkunganMigrasi", () => {
  it("tidak menuntut bucket rapor maupun kunci AI — fungsi migrate tidak menyentuh keduanya", () => {
    const lingkungan = pilihLingkunganMigrasi({
      LINGKUNGAN: "aws",
      AWS_REGION: AWS.AWS_REGION,
      DB_INANG: AWS.DB_INANG,
      DB_NAMA: AWS.DB_NAMA,
      RAHASIA_OWNER: "arn:aws:secretsmanager:ap-southeast-3:274286556151:secret:rds!db-x-AbCdEf",
    });

    expect(lingkungan.nama).toBe("aws");
  });

  it("membaca kredensial pemilik dari variabel lingkungan pada lingkungan lokal", async () => {
    const lingkungan = pilihLingkunganMigrasi(LOKAL);

    await expect(lingkungan.rahasia.urlBasisData("owner")).resolves.toBe(
      LOKAL.DATABASE_URL_MIGRASI,
    );
  });
});
