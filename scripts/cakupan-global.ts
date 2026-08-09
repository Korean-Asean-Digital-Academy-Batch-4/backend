import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import coverage, { type CoverageMapData } from "istanbul-lib-coverage";

export const AMBANG_CAKUPAN_GLOBAL = 80;
export type MetrikCakupan = "statements" | "branches" | "functions" | "lines";
export type RingkasanCakupan = Readonly<Record<MetrikCakupan, number>>;

const METRIK_CAKUPAN: readonly MetrikCakupan[] = ["statements", "branches", "functions", "lines"];
const LOKASI_ARTEFAK: readonly string[] = [
  "coverage/unit/coverage-final.json",
  "coverage/db/coverage-final.json",
];

export function ringkasCakupan(peta: readonly CoverageMapData[]): RingkasanCakupan {
  const gabungan = coverage.createCoverageMap();

  for (const cakupan of peta) {
    gabungan.merge(cakupan);
  }

  const ringkasan = gabungan.getCoverageSummary();
  return {
    statements: ringkasan.statements.pct,
    branches: ringkasan.branches.pct,
    functions: ringkasan.functions.pct,
    lines: ringkasan.lines.pct,
  };
}

export function periksaAmbang(
  ringkasan: RingkasanCakupan,
  ambang: number,
): readonly MetrikCakupan[] {
  return (Object.keys(ringkasan) as MetrikCakupan[]).filter((metrik) => ringkasan[metrik] < ambang);
}

function uraikanAmbang(argumen: readonly string[]): number | undefined {
  if (argumen.length !== 1) return undefined;

  const kecocokan = /^--ambang=(.+)$/.exec(argumen[0] ?? "");
  const nilaiAmbang = kecocokan?.[1]?.trim();
  if (!nilaiAmbang) return undefined;

  const ambang = Number(nilaiAmbang);
  return Number.isFinite(ambang) ? ambang : undefined;
}

async function bacaArtefak(direktoriKerja: string): Promise<readonly CoverageMapData[]> {
  try {
    const isiArtefak = await Promise.all(
      LOKASI_ARTEFAK.map(async (lokasi) => readFile(path.join(direktoriKerja, lokasi), "utf8")),
    );
    return isiArtefak.map((isi) => JSON.parse(isi) as CoverageMapData);
  } catch {
    throw new Error("artefak-cakupan-tidak-sah");
  }
}

function adalahRingkasanSah(ringkasan: RingkasanCakupan): boolean {
  return METRIK_CAKUPAN.every((metrik) => Number.isFinite(ringkasan[metrik]));
}

function cetakRingkasan(ringkasan: RingkasanCakupan): void {
  for (const metrik of METRIK_CAKUPAN) {
    process.stdout.write(`${metrik}: ${ringkasan[metrik]}%\n`);
  }
}

async function jalankanCli(): Promise<void> {
  const ambang = uraikanAmbang(process.argv.slice(2));
  if (ambang === undefined) {
    process.stderr.write("Argumen --ambang wajib berupa angka.\n");
    process.exitCode = 1;
    return;
  }

  let ringkasan: RingkasanCakupan;
  try {
    ringkasan = ringkasCakupan(await bacaArtefak(process.cwd()));
    if (!adalahRingkasanSah(ringkasan)) throw new Error("ringkasan-cakupan-tidak-sah");
  } catch {
    process.stderr.write("Gagal memproses artefak cakupan.\n");
    process.exitCode = 1;
    return;
  }

  cetakRingkasan(ringkasan);
  const metrikDiBawahAmbang = periksaAmbang(ringkasan, ambang);
  if (metrikDiBawahAmbang.length === 0) return;

  process.stderr.write(`Ambang cakupan tidak terpenuhi: ${metrikDiBawahAmbang.join(", ")}.\n`);
  process.exitCode = 1;
}

const jalurEntrypoint = process.argv[1];
if (jalurEntrypoint && path.resolve(jalurEntrypoint) === fileURLToPath(import.meta.url)) {
  void jalankanCli();
}
