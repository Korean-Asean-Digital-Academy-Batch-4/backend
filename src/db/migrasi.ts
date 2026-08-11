import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

/**
 * Enam lapis penjagaan migrasi ditetapkan DEPLOYMENT.md sec 6.5. Berkas ini
 * menegakkan lapis 0 — header klasifikasi — dan lapis 1 — penamaan `expand` dan
 * `contract` — sebagai galat, bukan sebagai kebiasaan yang perlu diingat.
 */
export const POLA_BERKAS_MIGRASI = /^(\d{4})_(expand|contract)_[a-z0-9_]+\.sql$/;

export const DIREKTORI_MIGRASI = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

const JENIS_MIGRASI = ["additive", "backward-compatible", "breaking", "dual-schema"] as const;
const PEMBACA = ["api", "migrate", "app_ro"] as const;
const KUNCI_HEADER = ["migrasi", "jenis", "mundur", "dibaca", "penutup"] as const;

// Baris `penutup` bagi migrasi yang tidak menunggu ditutup contract apa pun.
const TANPA_PENUTUP = ["—", "-"];

export type JenisMigrasi = (typeof JENIS_MIGRASI)[number];

export type HeaderMigrasi = {
  readonly migrasi: string;
  readonly jenis: JenisMigrasi;
  readonly mundur: string;
  readonly dibaca: readonly string[];
  readonly penutup: string | null;
};

export type HasilUraiHeader =
  | { readonly sah: true; readonly header: HeaderMigrasi }
  | { readonly sah: false; readonly sebab: string };

function tolak(sebab: string): HasilUraiHeader {
  return { sah: false, sebab };
}

/**
 * Menguraikan header klasifikasi pada lima baris pertama berkas migrasi.
 *
 * Yang dipaksa bukan formatnya, melainkan keputusannya ditulis alih-alih
 * disimpulkan — DEPLOYMENT.md sec 6.5 lapis 0.
 */
export function uraikanHeader(isi: string): HasilUraiHeader {
  const baris = isi.split("\n").slice(0, KUNCI_HEADER.length);
  const nilai = new Map<string, string>();

  for (const [indeks, kunci] of KUNCI_HEADER.entries()) {
    const cocok = baris[indeks]?.match(/^--\s*([a-z]+)\s*:\s*(.+?)\s*$/);
    if (!cocok || cocok[1] !== kunci) {
      return tolak(`baris ke-${indeks + 1} bukan "-- ${kunci} : ..."`);
    }
    nilai.set(kunci, cocok[2] ?? "");
  }

  const migrasi = nilai.get("migrasi") ?? "";
  if (!/^\d{4}$/.test(migrasi)) {
    return tolak(`nomor migrasi "${migrasi}" bukan empat digit`);
  }

  const jenis = nilai.get("jenis") ?? "";
  if (!(JENIS_MIGRASI as readonly string[]).includes(jenis)) {
    return tolak(`jenis "${jenis}" di luar ${JENIS_MIGRASI.join(", ")}`);
  }

  const mundur = nilai.get("mundur") ?? "";
  const jawabanMundur = mundur.match(/^(ya|tidak)\s*[—-]\s*(.+)$/);
  if (!jawabanMundur) {
    return tolak(`mundur "${mundur}" harus berbentuk "ya — alasan" atau "tidak — alasan"`);
  }

  const dibaca = (nilai.get("dibaca") ?? "").split(",").map((bagian) => bagian.trim());
  const asing = dibaca.filter((pembaca) => !(PEMBACA as readonly string[]).includes(pembaca));
  if (asing.length > 0) {
    return tolak(`pembaca tidak dikenal: ${asing.join(", ")}`);
  }

  const penutup = nilai.get("penutup") ?? "";
  if (!TANPA_PENUTUP.includes(penutup) && !/^\d{4}$/.test(penutup)) {
    return tolak(`penutup "${penutup}" bukan nomor migrasi maupun tanda tanpa penutup`);
  }

  return {
    sah: true,
    header: {
      migrasi,
      jenis: jenis as JenisMigrasi,
      mundur,
      dibaca,
      penutup: TANPA_PENUTUP.includes(penutup) ? null : penutup,
    },
  };
}

export function sidikJari(isi: string): string {
  return createHash("sha256").update(isi, "utf8").digest("hex");
}

/**
 * Berkas migrasi yang sah, terurut menurut nomornya.
 *
 * Nomor yang melompat atau kembar dilaporkan sebagai galat: keduanya berarti
 * urutan penerapan tidak lagi dapat dipastikan.
 */
export async function daftarBerkasMigrasi(direktori: string): Promise<string[]> {
  const isi = await readdir(direktori);
  const berkas = isi.filter((nama) => nama.endsWith(".sql")).sort();

  const asing = berkas.filter((nama) => !POLA_BERKAS_MIGRASI.test(nama));
  if (asing.length > 0) {
    throw new Error(`Berkas migrasi tidak mengikuti penamaan expand/contract: ${asing.join(", ")}`);
  }

  berkas.forEach((nama, indeks) => {
    const seharusnya = String(indeks + 1).padStart(4, "0");
    if (!nama.startsWith(seharusnya)) {
      throw new Error(`Nomor migrasi melompat atau kembar: diharapkan ${seharusnya}, ada ${nama}`);
    }
  });

  return berkas;
}

const SIAPKAN_CATATAN = `
CREATE SCHEMA IF NOT EXISTS migrasi;
CREATE TABLE IF NOT EXISTS migrasi.diterapkan (
    berkas          text        PRIMARY KEY,
    sidik_jari      text        NOT NULL,
    diterapkan_pada timestamptz NOT NULL DEFAULT now()
);`;

/**
 * Kunci penasihat yang dipegang selama penerapan berlangsung.
 *
 * Pipeline DEPLOYMENT.md sec 3.3 memang berurutan, tetapi dua rilis yang
 * bertabrakan — misalnya penggabungan beruntun ke `main` — memanggil fungsi
 * `migrate` dua kali pada saat yang sama. Tanpa kunci, keduanya membaca catatan
 * yang sama-sama kosong lalu menerapkan migrasi yang sama dua kali. Angkanya
 * sembarang; yang penting ia tetap sama di seluruh rilis.
 */
const KUNCI_PENERAPAN = 4_072_026;

/**
 * Menerapkan migrasi yang belum pernah dijalankan, satu berkas satu transaksi.
 *
 * Dipanggil pada **setiap** rilis (DEPLOYMENT.md sec 3.3 langkah 6), sehingga
 * pemanggilan berulang tanpa migrasi baru tidak melakukan apa pun. Catatannya
 * berada di skema `migrasi`, di luar sembilan belas tabel Pasal 3 — CK-S-10.
 *
 * @returns nama berkas yang baru diterapkan pada pemanggilan ini
 */
export async function terapkanMigrasi(pool: Pool, direktori: string): Promise<string[]> {
  wajibMuatDuaKoneksi(pool);

  const berkas = await daftarBerkasMigrasi(direktori);
  await pool.query(SIAPKAN_CATATAN);

  const penjaga = await pool.connect();
  try {
    await penjaga.query(`SELECT pg_advisory_lock($1)`, [KUNCI_PENERAPAN]);
    return await terapkanBerkas(pool, direktori, berkas);
  } finally {
    await penjaga.query(`SELECT pg_advisory_unlock($1)`, [KUNCI_PENERAPAN]).catch(() => undefined);
    penjaga.release();
  }
}

/**
 * Menolak pool yang terlalu sempit **sebelum** penerapan dimulai.
 *
 * Penerapan memegang satu koneksi sebagai penjaga advisory lock sepanjang
 * prosesnya, lalu menjalankan seluruh migrasinya lewat koneksi lain dari pool
 * yang sama. Pada `max: 1` keduanya berebut satu-satunya koneksi dan prosesnya
 * **menggantung tanpa pesan apa pun** — bukan gagal, hanya diam selamanya.
 *
 * Ini mudah terjadi karena `DB_POOL_MAX` memang bernilai 1 secara bawaan,
 * mengikuti disiplin pool Lambda ([ARCHITECTURE.md §6]). Diperiksa di sini
 * supaya kekeliruannya muncul sebagai kalimat, bukan sebagai perintah yang
 * tidak pernah selesai.
 */
function wajibMuatDuaKoneksi(pool: Pool): void {
  const maksimum = (pool as Pool & { options?: { max?: number } }).options?.max;
  if (typeof maksimum === "number" && maksimum < 2) {
    throw new Error(
      `Penerapan migrasi menuntut pool minimal 2 koneksi, diterima max: ${maksimum}. ` +
        `Satu koneksi dipegang penjaga advisory lock, satu lagi menjalankan migrasinya.`,
    );
  }
}

async function terapkanBerkas(pool: Pool, direktori: string, berkas: string[]): Promise<string[]> {
  const tercatat = await pool.query<{ berkas: string; sidik_jari: string }>(
    `SELECT berkas, sidik_jari FROM migrasi.diterapkan`,
  );
  const sudah = new Map(tercatat.rows.map((baris) => [baris.berkas, baris.sidik_jari]));

  const diterapkan: string[] = [];

  for (const nama of berkas) {
    const isi = await readFile(path.join(direktori, nama), "utf8");
    const sidik = sidikJari(isi);
    const sebelumnya = sudah.get(nama);

    if (sebelumnya !== undefined) {
      if (sebelumnya !== sidik) {
        throw new Error(
          `Migrasi ${nama} sudah diterapkan tetapi berubah isinya. ` +
            `Migrasi yang sudah berjalan tidak boleh disunting — tulis migrasi baru.`,
        );
      }
      continue;
    }

    const hasilUrai = uraikanHeader(isi);
    if (!hasilUrai.sah) {
      throw new Error(
        `Migrasi ${nama} tidak memiliki header klasifikasi yang sah: ${hasilUrai.sebab}`,
      );
    }

    const klien = await pool.connect();
    try {
      await klien.query("BEGIN");
      await klien.query(isi);
      await klien.query(`INSERT INTO migrasi.diterapkan (berkas, sidik_jari) VALUES ($1, $2)`, [
        nama,
        sidik,
      ]);
      await klien.query("COMMIT");
      diterapkan.push(nama);
    } catch (galat) {
      await klien.query("ROLLBACK").catch(() => undefined);
      const sebab = galat instanceof Error ? galat.message : String(galat);
      throw new Error(`Migrasi ${nama} gagal dan dibatalkan seluruhnya: ${sebab}`);
    } finally {
      klien.release();
    }
  }

  return diterapkan;
}
