import { Pool } from "pg";

import { bacaKonfigurasi, bacaKonfigurasiMigrasi } from "../config.js";

/**
 * Menetapkan kata sandi `app_rw` dan `app_ro` pada PostgreSQL.
 *
 *     npm run db:siapkan-role
 *
 * **Kenapa langkah ini terpisah dari migrasi.** Migrasi `0009` membuat kedua
 * role dengan `CREATE ROLE … LOGIN` **tanpa kata sandi**, karena migrasi
 * disimpan di git dan sidik jarinya membuatnya tidak pernah boleh disunting
 * (CK-S-09, temuan S-06). Kata sandi yang tertulis di sana akan terbaca siapa
 * pun yang dapat meng-`clone`, dan tidak akan pernah dapat diganti.
 *
 * Perintah ini menutup jendela itu untuk **pengembangan lokal**: kata sandinya
 * dibaca dari `DATABASE_URL` dan `DATABASE_URL_RO` pada `.env`, lalu dipasang
 * ke basis data. Dengan begitu `.env` menjadi satu-satunya tempat kata sandi
 * lokal ditulis, dan basis data selalu cocok dengannya.
 *
 * Di AWS langkah yang sama dikerjakan fungsi `migrate`, dengan kata sandi
 * dibaca dari Secrets Manager alih-alih `.env` ([DEPLOYMENT.md §5.1]).
 */

type Kredensial = Readonly<{ peran: string; sandi: string }>;

/** Membaca nama role dan kata sandi dari satu URL koneksi. */
function bacaKredensial(nama: string, url: string): Kredensial {
  let terurai: URL;
  try {
    terurai = new URL(url);
  } catch {
    throw new Error(`${nama} bukan URL yang sah.`);
  }

  const peran = decodeURIComponent(terurai.username);
  const sandi = decodeURIComponent(terurai.password);

  if (peran.length === 0) throw new Error(`${nama} tidak memuat nama role.`);
  if (sandi.length === 0) throw new Error(`${nama} tidak memuat kata sandi.`);

  return { peran, sandi };
}

/**
 * Menjalankan `ALTER ROLE` dengan pengutipan yang dikerjakan PostgreSQL sendiri.
 *
 * `ALTER ROLE` tidak menerima parameter terikat pada nama role maupun kata
 * sandinya, sehingga keduanya wajib masuk ke dalam teks pernyataan. Alih-alih
 * merangkainya sendiri — cara yang selalu salah pada kata sandi yang memuat
 * kutip — pernyataannya disusun `format()` di dalam basis data lewat `%I` dan
 * `%L`, yang memang bertugas mengutip pengenal dan literal dengan benar.
 */
async function tetapkanKataSandi(pool: Pool, kredensial: Kredensial): Promise<void> {
  const disusun = await pool.query<{ pernyataan: string }>(
    `SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS pernyataan`,
    [kredensial.peran, kredensial.sandi],
  );
  await pool.query(disusun.rows[0]!.pernyataan);
}

const konfigurasi = bacaKonfigurasi();
const konfigurasiMigrasi = bacaKonfigurasiMigrasi();

const kredensial = [
  bacaKredensial("DATABASE_URL", konfigurasi.DATABASE_URL),
  bacaKredensial("DATABASE_URL_RO", konfigurasi.DATABASE_URL_RO),
];

const pool = new Pool({ connectionString: konfigurasiMigrasi.DATABASE_URL_MIGRASI, max: 1 });

try {
  for (const satu of kredensial) {
    await tetapkanKataSandi(pool, satu);
    // Kata sandinya sendiri tidak pernah dicetak — Techstack.md §7 butir 2.
    console.log(`Kata sandi role ${satu.peran} ditetapkan.`);
  }
} catch (galat) {
  console.error(`Penyiapan role gagal: ${galat instanceof Error ? galat.message : String(galat)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
