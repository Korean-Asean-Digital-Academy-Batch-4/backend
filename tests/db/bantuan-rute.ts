import type { AddressInfo } from "node:net";

import { kataSandiArgon2id } from "../../src/adapters/local/kata-sandi.js";
import { berkasAdministrasiLokal } from "../../src/adapters/local/berkas-administrasi/index.js";
import { buatApp } from "../../src/app.js";
import { buatBasisData } from "../../src/db/drizzle.js";
import type { DependensiApp } from "../../src/dependensi-app.js";
import { poolPemilik } from "./bantuan.js";

export type AppUji = Readonly<{ asal: string; tutup: () => Promise<void> }>;
export type PilihanJson = Readonly<{
  metode?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  sesi?: string;
  badan?: unknown;
}>;
export type JawabanUji = Readonly<{
  status: number;
  kepala: Headers;
  badan: unknown;
}>;

const KATA_SANDI_FIXTURE = "kata-sandi-uji";

export async function nyalakanAppUji(pilihan: Partial<DependensiApp> = {}): Promise<AppUji> {
  const pool = pilihan.pool ?? poolPemilik();
  const dependensi: DependensiApp = {
    pool,
    db: pilihan.db ?? buatBasisData(pool),
    kataSandi: pilihan.kataSandi ?? kataSandiArgon2id(),
    berkasAdministrasi: pilihan.berkasAdministrasi ?? berkasAdministrasiLokal(),
    sekarang: pilihan.sekarang ?? (() => new Date()),
  };
  const server = buatApp(dependensi).listen(0);
  await new Promise<void>((selesai, gagal) => {
    const saatMendengarkan = (): void => {
      server.removeListener("error", saatGalat);
      selesai();
    };
    const saatGalat = (galat: Error): void => {
      server.removeListener("listening", saatMendengarkan);
      gagal(galat);
    };
    server.once("listening", saatMendengarkan);
    server.once("error", saatGalat);
  });
  const alamat = server.address() as AddressInfo;

  return {
    asal: `http://127.0.0.1:${alamat.port}`,
    tutup: () =>
      new Promise<void>((selesai, gagal) => {
        server.close((galat) => (galat ? gagal(galat) : selesai()));
      }),
  };
}

export function panggilJson(
  app: AppUji,
  jalan: string,
  pilihan: PilihanJson = {},
): Promise<JawabanUji> {
  return panggil(app, jalan, {
    metode: pilihan.metode,
    sesi: pilihan.sesi,
    jenisIsi: "application/json",
    badan:
      pilihan.badan === undefined || (pilihan.metode ?? "GET") === "GET"
        ? undefined
        : JSON.stringify(pilihan.badan),
  });
}

export function panggilJsonMentah(
  app: AppUji,
  jalan: string,
  badan: string,
  metode: "POST" | "PATCH" | "PUT" = "POST",
): Promise<JawabanUji> {
  return panggil(app, jalan, { metode, jenisIsi: "application/json", badan });
}

export function panggilMultipart(app: AppUji, jalan: string, form: FormData): Promise<JawabanUji> {
  return panggil(app, jalan, { metode: "POST", badan: form });
}

/**
 * Masuk sebagai akun fixture.
 *
 * `namaPengguna` berawalan `a6-` dipakai apa adanya: kata sandi akun fixture
 * A6 itu diganti milik fixture, lalu dipakai masuk. Akun benih bersama
 * (`admin`, `198001011001`, `2026001`, …) TIDAK pernah disentuh — hash mereka
 * diuji keutuhannya oleh rute-templat.test.ts; selain itu dibuat akun fixture
 * `uji-a5-<peran>` sesuai peran akun yang disebut — perilaku bawaan A5.
 */
export async function masukSebagai(app: AppUji, namaPengguna: string): Promise<string> {
  const peranHasil = await poolPemilik().query<{ peran: string }>(
    `SELECT peran FROM pengguna WHERE nama_pengguna = $1`,
    [namaPengguna],
  );
  const peranDisebut = peranHasil.rows[0]?.peran;

  // Akun uji A6 yang disebut eksplisit: kata sandinya diganti milik fixture,
  // lalu dipakai masuk — tanpa membuat akun baru.
  if (namaPengguna.startsWith("a6-") && (peranDisebut === "guru" || peranDisebut === "siswa")) {
    const hash = await kataSandiArgon2id().hash(KATA_SANDI_FIXTURE);
    await poolPemilik().query(`UPDATE pengguna SET kata_sandi_hash = $1 WHERE nama_pengguna = $2`, [
      hash,
      namaPengguna,
    ]);
    const jawab = await panggilJson(app, "/api/auth/masuk", {
      metode: "POST",
      badan: { nama_pengguna: namaPengguna, kata_sandi: KATA_SANDI_FIXTURE },
    });
    if (jawab.status !== 200) throw new Error("Fixture gagal membuat sesi uji.");
    const cookie = jawab.kepala.get("set-cookie")?.match(/edutrack_sesi=([^;]+)/)?.[1];
    if (!cookie) throw new Error("Respons fixture tidak memuat cookie sesi.");
    return `edutrack_sesi=${cookie}`;
  }

  const peran = peranDisebut;
  if (peran !== "administrator" && peran !== "guru" && peran !== "siswa") {
    throw new Error("Peran kredensial fixture tidak dikenal.");
  }

  const hash = await kataSandiArgon2id().hash(KATA_SANDI_FIXTURE);
  const namaFixture = `uji-a5-${peran}`;
  const klien = await poolPemilik().connect();
  try {
    await klien.query("BEGIN");
    await klien.query(
      `INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [namaFixture, `Fixture ${peran}`, peran, hash],
    );
    const pengguna = await klien.query<{ id: string }>(
      `UPDATE pengguna SET kata_sandi_hash = $1
       WHERE nama_pengguna = $2 AND peran = $3 RETURNING id`,
      [hash, namaFixture, peran],
    );
    const id = pengguna.rows[0]?.id;
    if (!id) throw new Error("Akun fixture tidak dapat disiapkan.");
    if (peran === "guru") {
      await klien.query(`INSERT INTO guru (pengguna_ref) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
    } else if (peran === "siswa") {
      await klien.query(`INSERT INTO siswa (pengguna_ref) VALUES ($1) ON CONFLICT DO NOTHING`, [
        id,
      ]);
    }
    await klien.query("COMMIT");
  } catch (galat) {
    await klien.query("ROLLBACK").catch(() => undefined);
    throw galat;
  } finally {
    klien.release();
  }
  const jawab = await panggilJson(app, "/api/auth/masuk", {
    metode: "POST",
    badan: { nama_pengguna: namaFixture, kata_sandi: KATA_SANDI_FIXTURE },
  });
  if (jawab.status !== 200) throw new Error("Fixture gagal membuat sesi uji.");
  const cookie = jawab.kepala.get("set-cookie")?.match(/edutrack_sesi=([^;]+)/)?.[1];
  if (!cookie) throw new Error("Respons fixture tidak memuat cookie sesi.");
  return `edutrack_sesi=${cookie}`;
}

type PilihanPanggil = Readonly<{
  metode?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  sesi?: string;
  jenisIsi?: string;
  badan?: string | FormData;
}>;

async function panggil(app: AppUji, jalan: string, pilihan: PilihanPanggil): Promise<JawabanUji> {
  const jawab = await fetch(`${app.asal}${jalan}`, {
    method: pilihan.metode ?? "GET",
    headers: {
      ...(pilihan.jenisIsi ? { "content-type": pilihan.jenisIsi } : {}),
      ...(pilihan.sesi ? { cookie: pilihan.sesi } : {}),
    },
    ...(pilihan.badan === undefined ? {} : { body: pilihan.badan }),
  });
  const jenisIsi = jawab.headers.get("content-type") ?? "";
  const badan = jenisIsi.includes("application/json")
    ? await jawab.json()
    : Buffer.from(await jawab.arrayBuffer());
  return { status: jawab.status, kepala: jawab.headers, badan };
}
