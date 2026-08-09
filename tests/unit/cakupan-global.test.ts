import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { CoverageMapData } from "istanbul-lib-coverage";
import { describe, expect, it } from "vitest";

import { periksaAmbang, ringkasCakupan } from "../../scripts/cakupan-global.js";

const jalankanBerkas = promisify(execFile);
const DIREKTORI_PROYEK = path.resolve(import.meta.dirname, "../..");
const JALUR_TSX = path.join(DIREKTORI_PROYEK, "node_modules/tsx/dist/cli.mjs");
const JALUR_SKRIP = path.join(DIREKTORI_PROYEK, "scripts/cakupan-global.ts");

type PetaCakupan = CoverageMapData;

function petaDenganHit(hit: number): PetaCakupan {
  return {
    "/src/contoh.ts": {
      path: "/src/contoh.ts",
      statementMap: {
        "0": {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 1 },
        },
      },
      fnMap: {},
      branchMap: {},
      s: { "0": hit },
      f: {},
      b: {},
    },
  };
}

async function tulisArtefak(
  direktori: string,
  nama: "unit" | "db",
  peta: PetaCakupan,
): Promise<void> {
  const tujuan = path.join(direktori, "coverage", nama);
  await mkdir(tujuan, { recursive: true });
  await writeFile(path.join(tujuan, "coverage-final.json"), JSON.stringify(peta), "utf8");
}

async function jalankanCli(direktori: string, ...argumen: string[]) {
  try {
    const hasil = await jalankanBerkas(process.execPath, [JALUR_TSX, JALUR_SKRIP, ...argumen], {
      cwd: direktori,
    });
    return { status: 0, stdout: hasil.stdout, stderr: hasil.stderr };
  } catch (error: unknown) {
    const proses = error as { code?: number; stdout?: string; stderr?: string };
    return {
      status: proses.code ?? 1,
      stdout: proses.stdout ?? "",
      stderr: proses.stderr ?? "",
    };
  }
}

describe("cakupan global", () => {
  it("menggabungkan hit dua suite atas berkas yang sama", () => {
    const ringkasan = ringkasCakupan([petaDenganHit(1), petaDenganHit(0)]);
    expect(ringkasan.statements).toBe(100);
  });

  it("menyebut setiap metrik yang berada di bawah ambang", () => {
    expect(periksaAmbang({ statements: 81, branches: 79, functions: 78, lines: 82 }, 80)).toEqual([
      "branches",
      "functions",
    ]);
  });

  it("menggabungkan dua artefak sah dan mencetak empat metrik", async () => {
    const direktori = await mkdtemp(path.join(tmpdir(), "cakupan-global-"));
    try {
      await tulisArtefak(direktori, "unit", petaDenganHit(1));
      await tulisArtefak(direktori, "db", petaDenganHit(0));

      const hasil = await jalankanCli(direktori, "--ambang=0");

      expect(hasil.status).toBe(0);
      expect(hasil.stdout).toContain("statements: 100%");
      expect(hasil.stdout).toContain("branches: 100%");
      expect(hasil.stdout).toContain("functions: 100%");
      expect(hasil.stdout).toContain("lines: 100%");
    } finally {
      await rm(direktori, { recursive: true, force: true });
    }
  });

  it("gagal aman jika artefak hilang atau JSON rusak", async () => {
    const direktori = await mkdtemp(path.join(tmpdir(), "cakupan-global-"));
    try {
      await tulisArtefak(direktori, "unit", petaDenganHit(1));
      const tanpaDb = await jalankanCli(direktori, "--ambang=0");
      expect(tanpaDb.status).not.toBe(0);
      expect(tanpaDb.stderr).toContain("Gagal memproses artefak cakupan.");
      expect(tanpaDb.stderr).not.toContain(direktori);

      await tulisArtefak(direktori, "db", petaDenganHit(1));
      await writeFile(
        path.join(direktori, "coverage", "db", "coverage-final.json"),
        "{bukan-json",
        "utf8",
      );
      const jsonRusak = await jalankanCli(direktori, "--ambang=0");
      expect(jsonRusak.status).not.toBe(0);
      expect(jsonRusak.stderr).toContain("Gagal memproses artefak cakupan.");
      expect(jsonRusak.stderr).not.toContain("SyntaxError");

      await writeFile(
        path.join(direktori, "coverage", "unit", "coverage-final.json"),
        "{}",
        "utf8",
      );
      await writeFile(path.join(direktori, "coverage", "db", "coverage-final.json"), "{}", "utf8");
      const petaKosong = await jalankanCli(direktori, "--ambang=0");
      expect(petaKosong.status).not.toBe(0);
      expect(petaKosong.stderr).toContain("Gagal memproses artefak cakupan.");
      expect(petaKosong.stdout).not.toContain("Unknown");
    } finally {
      await rm(direktori, { recursive: true, force: true });
    }
  });

  it("menolak argumen ambang yang hilang atau bukan angka", async () => {
    const direktori = await mkdtemp(path.join(tmpdir(), "cakupan-global-"));
    try {
      await tulisArtefak(direktori, "unit", petaDenganHit(1));
      await tulisArtefak(direktori, "db", petaDenganHit(1));

      const tanpaAmbang = await jalankanCli(direktori);
      expect(tanpaAmbang.status).not.toBe(0);
      expect(tanpaAmbang.stderr).toContain("Argumen --ambang wajib berupa angka.");

      const bukanAngka = await jalankanCli(direktori, "--ambang=tinggi");
      expect(bukanAngka.status).not.toBe(0);
      expect(bukanAngka.stderr).toContain("Argumen --ambang wajib berupa angka.");

      const spasiSaja = await jalankanCli(direktori, "--ambang= ");
      expect(spasiSaja.status).not.toBe(0);
      expect(spasiSaja.stderr).toContain("Argumen --ambang wajib berupa angka.");
    } finally {
      await rm(direktori, { recursive: true, force: true });
    }
  });

  it("mengembalikan kode keluar sesuai hasil ambang", async () => {
    const direktori = await mkdtemp(path.join(tmpdir(), "cakupan-global-"));
    try {
      await tulisArtefak(direktori, "unit", petaDenganHit(1));
      await tulisArtefak(direktori, "db", petaDenganHit(0));

      const ambangTinggi = await jalankanCli(direktori, "--ambang=101");
      expect(ambangTinggi.status).not.toBe(0);
      expect(ambangTinggi.stderr).toContain(
        "Ambang cakupan tidak terpenuhi: statements, branches, functions, lines.",
      );

      const ambangRendah = await jalankanCli(direktori, "--ambang=99");
      expect(ambangRendah.status).toBe(0);
    } finally {
      await rm(direktori, { recursive: true, force: true });
    }
  });
});
