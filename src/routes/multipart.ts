import type { Request } from "express";
import Busboy from "busboy";
import type { Busboy as PenguraiBusboy, FileInfo } from "busboy";
import type { Readable } from "node:stream";

import { BATAS_UNGGAH_BYTE } from "../ports/berkas-administrasi.js";

export { BATAS_UNGGAH_BYTE } from "../ports/berkas-administrasi.js";

type KodeMultipart = "PERMINTAAN_TIDAK_SAH" | "BERKAS_TIDAK_SAH" | "BERKAS_TERLALU_BESAR";

export type HasilBacaMultipart =
  | Readonly<{
      berhasil: true;
      berkas: Buffer;
      bidang: Readonly<Record<string, string>>;
    }>
  | Readonly<{
      berhasil: false;
      status: 400 | 413;
      kode: KodeMultipart;
      pesan: string;
    }>;

const TIDAK_SAH: HasilBacaMultipart = {
  berhasil: false,
  status: 400,
  kode: "BERKAS_TIDAK_SAH",
  pesan: "Berkas multipart tidak sah.",
};
const BENTUK_PERMINTAAN_TIDAK_SAH: HasilBacaMultipart = {
  berhasil: false,
  status: 400,
  kode: "PERMINTAAN_TIDAK_SAH",
  pesan: "Bentuk permintaan multipart tidak sah.",
};
const TERLALU_BESAR: HasilBacaMultipart = {
  berhasil: false,
  status: 413,
  kode: "BERKAS_TERLALU_BESAR",
  pesan: "Berkas melebihi batas 2 MiB.",
};

export function bacaBerkasMultipart(req: Request): Promise<HasilBacaMultipart> {
  if (requestSudahBerakhir(req)) {
    kurasRequestDenganAman(req);
    return Promise.resolve(TIDAK_SAH);
  }

  let pengurai: PenguraiBusboy;
  try {
    pengurai = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fields: 2,
        parts: 3,
        fileSize: BATAS_UNGGAH_BYTE,
        fieldSize: 16 * 1024,
      },
    });
  } catch {
    kurasRequestDenganAman(req);
    return Promise.resolve(TIDAK_SAH);
  }

  return new Promise((selesai) => {
    let tuntas = false;
    let aliranBerkas: Readable | undefined;
    let jumlahBerkas = 0;
    let terlaluBesar = false;
    const potongan: Buffer[] = [];
    const bidang: Array<readonly [string, string]> = [];

    const abaikanGalatDrain = (): void => undefined;
    const lepasPenjagaDrain = (): void => {
      req.removeListener("error", abaikanGalatDrain);
      req.removeListener("end", lepasPenjagaDrain);
      req.removeListener("close", lepasPenjagaDrain);
    };

    const bersihkanDanKuras = (): void => {
      req.removeListener("aborted", saatBatal);
      req.removeListener("error", saatGalat);
      req.on("error", abaikanGalatDrain);
      req.once("end", lepasPenjagaDrain);
      req.once("close", lepasPenjagaDrain);
      pengurai.removeAllListeners();
      pengurai.on("error", abaikanGalatDrain);
      if (aliranBerkas) {
        aliranBerkas.removeAllListeners("limit");
        aliranBerkas.removeAllListeners("data");
        aliranBerkas.removeListener("error", saatGalat);
        aliranBerkas.on("error", abaikanGalatDrain);
      }
      pengurai.destroy();
      if (req.readableEnded || req.closed) setImmediate(lepasPenjagaDrain);
    };

    const tuntaskan = (hasil: HasilBacaMultipart): void => {
      if (tuntas) return;
      tuntas = true;
      req.unpipe(pengurai);
      bersihkanDanKuras();
      req.resume();
      selesai(hasil);
    };

    const saatBatal = (): void => tuntaskan(TIDAK_SAH);
    const saatGalat = (): void => tuntaskan(TIDAK_SAH);

    req.once("aborted", saatBatal);
    req.once("error", saatGalat);
    pengurai.once("error", saatGalat);
    pengurai.once("filesLimit", () => tuntaskan(TIDAK_SAH));
    pengurai.once("fieldsLimit", () => tuntaskan(BENTUK_PERMINTAAN_TIDAK_SAH));
    pengurai.once("partsLimit", () => tuntaskan(BENTUK_PERMINTAAN_TIDAK_SAH));
    pengurai.on("field", (nama, nilai, info) => {
      if (info.nameTruncated || info.valueTruncated || bidang.some(([ada]) => ada === nama)) {
        tuntaskan(TIDAK_SAH);
        return;
      }
      bidang.push([nama, nilai]);
    });
    pengurai.on("file", (nama, aliran, _info: FileInfo) => {
      jumlahBerkas += 1;
      aliranBerkas = aliran;
      if (nama !== "berkas" || jumlahBerkas !== 1) {
        aliran.resume();
        tuntaskan(TIDAK_SAH);
        return;
      }
      aliran.once("limit", () => {
        terlaluBesar = true;
        tuntaskan(TERLALU_BESAR);
      });
      aliran.on("data", (potong: Buffer) => {
        if (!tuntas) potongan.push(Buffer.from(potong));
      });
      aliran.once("error", saatGalat);
    });
    pengurai.once("close", () => {
      if (terlaluBesar) {
        tuntaskan(TERLALU_BESAR);
      } else if (jumlahBerkas !== 1) {
        tuntaskan(TIDAK_SAH);
      } else {
        tuntaskan({
          berhasil: true,
          berkas: Buffer.concat(potongan),
          bidang: Object.freeze(Object.fromEntries(bidang)),
        });
      }
    });

    if (requestSudahBerakhir(req)) {
      tuntaskan(TIDAK_SAH);
      return;
    }
    req.pipe(pengurai);
  });
}

function requestSudahBerakhir(req: Request): boolean {
  return req.aborted || req.destroyed || req.readableEnded;
}

function kurasRequestDenganAman(req: Request): void {
  const abaikanGalat = (): void => undefined;
  const selesai = (): void => {
    req.removeListener("error", abaikanGalat);
    req.removeListener("end", selesai);
    req.removeListener("close", selesai);
  };
  req.on("error", abaikanGalat);
  req.once("end", selesai);
  req.once("close", selesai);
  if (req.readableEnded || req.closed) {
    setImmediate(selesai);
    return;
  }
  if (!req.destroyed && !req.readableEnded) req.resume();
}
