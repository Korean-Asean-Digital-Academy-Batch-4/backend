import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";

import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { BATAS_UNGGAH_BYTE, bacaBerkasMultipart } from "../../../src/routes/multipart.js";

const BATAS = "uji-edutrack-batas";

type Bagian =
  | Readonly<{ jenis: "berkas"; nama?: string; nilai: Buffer }>
  | Readonly<{ jenis: "bidang"; nama: string; nilai: string }>;

function badanMultipart(bagian: readonly Bagian[]): Buffer {
  const potongan: Buffer[] = [];
  for (const item of bagian) {
    potongan.push(Buffer.from(`--${BATAS}\r\n`));
    if (item.jenis === "berkas") {
      potongan.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${item.nama ?? "berkas"}"; filename="abaikan.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        item.nilai,
        Buffer.from("\r\n"),
      );
    } else {
      potongan.push(
        Buffer.from(`Content-Disposition: form-data; name="${item.nama}"\r\n\r\n${item.nilai}\r\n`),
      );
    }
  }
  potongan.push(Buffer.from(`--${BATAS}--\r\n`));
  return Buffer.concat(potongan);
}

async function ujiPembacaMultipart(muatan: Buffer, bagian?: readonly Bagian[]) {
  const req = Readable.from(
    badanMultipart(bagian ?? [{ jenis: "berkas", nilai: muatan }]),
  ) as Request;
  req.headers = { "content-type": `multipart/form-data; boundary=${BATAS}` };

  const hasil = await bacaBerkasMultipart(req);
  return hasil.berhasil
    ? { status: 200, badan: { data: hasil } }
    : { status: hasil.status, badan: { kesalahan: { kode: hasil.kode } } };
}

describe("bacaBerkasMultipart", () => {
  it("membaca satu berkas beserta bidangnya", async () => {
    const jawab = await ujiPembacaMultipart(Buffer.from("isi"), [
      { jenis: "bidang", nama: "peran", nilai: "guru" },
      { jenis: "berkas", nilai: Buffer.from("isi") },
    ]);

    expect(jawab.status).toBe(200);
    expect(jawab.badan).toMatchObject({
      data: { berkas: Buffer.from("isi"), bidang: { peran: "guru" } },
    });
  });

  it("menolak ketika berkas tidak ada", async () => {
    const jawab = await ujiPembacaMultipart(Buffer.alloc(0), [
      { jenis: "bidang", nama: "peran", nilai: "guru" },
    ]);

    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TIDAK_SAH" } });
  });

  it("menolak dua berkas", async () => {
    const jawab = await ujiPembacaMultipart(Buffer.alloc(0), [
      { jenis: "berkas", nilai: Buffer.from("satu") },
      { jenis: "berkas", nilai: Buffer.from("dua") },
    ]);

    expect(jawab.status).toBe(400);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TIDAK_SAH" } });
  });

  it("menolak aliran segera setelah batas 2 MiB", async () => {
    const jawab = await ujiPembacaMultipart(Buffer.alloc(BATAS_UNGGAH_BYTE + 1));

    expect(jawab.status).toBe(413);
    expect(jawab.badan).toMatchObject({ kesalahan: { kode: "BERKAS_TERLALU_BESAR" } });
  });

  it("menolak lebih dari dua bidang dan tidak menggantung", async () => {
    const jawab = await ujiPembacaMultipart(Buffer.alloc(0), [
      { jenis: "bidang", nama: "a", nilai: "1" },
      { jenis: "bidang", nama: "b", nilai: "2" },
      { jenis: "bidang", nama: "c", nilai: "3" },
    ]);

    expect(jawab.status).toBe(400);
  });

  it("menolak bidang di atas 16 KiB dan tidak menggantung", async () => {
    const jawab = await ujiPembacaMultipart(Buffer.alloc(0), [
      { jenis: "bidang", nama: "a", nilai: "x".repeat(16 * 1024 + 1) },
    ]);

    expect(jawab.status).toBe(400);
  });

  it("menolak content-type yang bukan multipart", async () => {
    const req = Readable.from(Buffer.from("bukan multipart")) as Request;
    req.headers = { "content-type": "application/json" };

    await expect(bacaBerkasMultipart(req)).resolves.toMatchObject({
      berhasil: false,
      status: 400,
      kode: "BERKAS_TIDAK_SAH",
    });
  });

  it("tetap menjaga galat saat request dengan content-type salah dikuras", async () => {
    const sumber = new PassThrough();
    const req = sumber as unknown as Request;
    req.headers = { "content-type": "application/json" };

    await expect(bacaBerkasMultipart(req)).resolves.toMatchObject({ berhasil: false, status: 400 });
    expect(sumber.listenerCount("error")).toBeGreaterThan(0);
    expect(() => sumber.emit("error", new Error("galat jaringan terlambat"))).not.toThrow();
    sumber.end();
  });

  it("menyelesaikan pembacaan segera ketika request sudah terputus", async () => {
    const sumber = new PassThrough();
    const req = sumber as unknown as Request;
    req.headers = { "content-type": `multipart/form-data; boundary=${BATAS}` };
    sumber.destroy();

    const hasil = await Promise.race([
      bacaBerkasMultipart(req),
      new Promise<"waktu-habis">((selesai) => setTimeout(() => selesai("waktu-habis"), 100)),
    ]);

    expect(hasil).not.toBe("waktu-habis");
    expect(hasil).toMatchObject({ berhasil: false, status: 400 });
    expect(sumber.listenerCount("error")).toBeGreaterThan(0);
    expect(() => sumber.emit("error", new Error("galat jaringan setelah putus"))).not.toThrow();
  });

  it("melepas penjaga ketika request sudah sepenuhnya ditutup", async () => {
    const sumber = new PassThrough();
    const req = sumber as unknown as Request;
    req.headers = { "content-type": `multipart/form-data; boundary=${BATAS}` };
    sumber.destroy();
    await once(sumber, "close");

    await expect(bacaBerkasMultipart(req)).resolves.toMatchObject({ berhasil: false, status: 400 });
    await new Promise<void>((selesai) => setImmediate(selesai));

    expect(sumber.listenerCount("error")).toBe(0);
    expect(sumber.listenerCount("end")).toBe(0);
    expect(sumber.listenerCount("close")).toBe(0);
  });

  it("menahan galat jaringan yang datang ketika sisa request sedang dikuras", async () => {
    const sumber = new PassThrough();
    const req = sumber as unknown as Request;
    req.headers = { "content-type": `multipart/form-data; boundary=${BATAS}` };
    const hasilPromise = bacaBerkasMultipart(req);
    sumber.write(badanMultipart([{ jenis: "berkas", nilai: Buffer.alloc(BATAS_UNGGAH_BYTE + 1) }]));

    await expect(hasilPromise).resolves.toMatchObject({ berhasil: false, status: 413 });
    expect(sumber.listenerCount("error")).toBeGreaterThan(0);
    expect(() => sumber.emit("error", new Error("galat jaringan terlambat"))).not.toThrow();
    sumber.end();
  });
});
