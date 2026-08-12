import { Pool } from "pg";

import { kataSandiArgon2id } from "../src/adapters/local/kata-sandi.js";
import { PANJANG_MAKSIMUM, bacaKataSandi } from "../src/entry/kata-sandi-masukan.js";

/**
 * Administrator pertama di lingkungan AWS — CK-A-14, [ARCHITECTURE.md §9.3].
 *
 * Dijalankan **dari mesin operator** terhadap RDS lewat terowongan SSM, bukan
 * dari dalam Lambda. Sebabnya bukan kemudahan: `stdin` tidak dapat disalurkan
 * ke dalam invocation Lambda, sedangkan justru dari `stdin`-lah kata sandi ini
 * dibaca.
 *
 * ```bash
 * printf '%s' '<kata sandi>' | DATABASE_URL_ADMIN=... npx tsx scripts/seed-admin-aws.ts <pengenal> "<nama lengkap>"
 * ```
 *
 * ## Kenapa berkas ini ada, padahal `seed:admin` sudah ada
 *
 * `src/entry/seed-admin.ts` memanggil `bacaKonfigurasi()`, yang mewajibkan
 * `ELICE_BASE_URL`, `ELICE_MODEL`, dan `ELICE_API_KEY`. Perintah yang membuat
 * akun paling berkuasa di sistem tidak boleh menuntut kredensial layanan AI
 * hanya untuk menyala. Berkas ini menerima satu URL koneksi dan tidak lebih.
 *
 * ## Yang TIDAK disederhanakan
 *
 * Hash tetap dibangkitkan `kataSandiArgon2id()`, yaitu adapter yang sama dengan
 * yang dipakai jalur masuk. Hash yang dirangkai sendiri bukan penyederhanaan
 * melainkan akun yang tidak dapat dipakai masuk — dan kegagalannya baru
 * terlihat pada percobaan masuk pertama, bukan pada saat pembuatan.
 *
 * Kata sandi **tidak pernah menjadi argumen proses** dan **tidak pernah
 * dicetak**: argumen terbaca pengguna lain lewat `ps` dan tersimpan pada
 * riwayat shell, sedangkan operator sudah memegang kata sandinya.
 *
 * Cukup `app_rw` — `INSERT` pada `pengguna` sudah diberikan migrasi `0009`, dan
 * kredensial pemilik tidak diperlukan.
 */

function berhenti(pesan: string): never {
  console.error(pesan);
  process.exit(1);
}

const bendera = process.argv.slice(2);
const ganti = bendera.includes("--ganti-kata-sandi");
const argumen = bendera.filter((satu) => !satu.startsWith("--"));
const namaPengguna = argumen[0];
const nama = argumen[1] ?? argumen[0];

if (!namaPengguna) {
  berhenti('Pemakaian: npx tsx scripts/seed-admin-aws.ts <pengenal> "<nama lengkap>"');
}

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  berhenti("DATABASE_URL_ADMIN wajib diisi — URL koneksi app_rw lewat terowongan.");
}

const kataSandiPolos = await bacaKataSandi("Kata sandi Administrator: ");
if (kataSandiPolos.length === 0) {
  berhenti("Kata sandi kosong. Salurkan lewat stdin, atau ketikkan saat diminta.");
}
if (kataSandiPolos.length > PANJANG_MAKSIMUM) {
  berhenti(`Kata sandi melampaui ${PANJANG_MAKSIMUM} aksara.`);
}

const pool = new Pool({ connectionString: url, max: 1 });

try {
  const hash = await kataSandiArgon2id().hash(kataSandiPolos);

  if (ganti) {
    // Seluruh sesi dicabut, berbeda dari penggantian oleh pemilik akun sendiri
    // yang mempertahankan sesi yang sedang dipakai. Jalur ini dipakai ketika
    // akunnya sudah tidak dapat dimasuki lagi, sehingga tidak ada sesi yang
    // layak dipertahankan — sama seperti `db/administrator.ts`.
    const diganti = await pool.query<{ id: string }>(
      `UPDATE pengguna SET kata_sandi_hash = $1, diperbarui_pada = now()
       WHERE lower(nama_pengguna) = lower($2) AND peran = 'administrator'
       RETURNING id`,
      [hash, namaPengguna],
    );

    const id = diganti.rows[0]?.id;
    if (!id) berhenti(`Administrator "${namaPengguna}" tidak ditemukan.`);

    const sesi = await pool.query(`DELETE FROM sesi_masuk WHERE pengguna_ref = $1`, [id]);
    console.log(`Kata sandi ${namaPengguna} diganti. ${sesi.rowCount ?? 0} sesi dicabut.`);
  } else {
    // `ON CONFLICT DO NOTHING`: perintah ini TIDAK menimpa akun yang sudah ada.
    // Penggantian kata sandi adalah tindakan lain, dan menyamarkannya sebagai
    // pembuatan akan membuat sebuah salah ketik menimpa Administrator yang
    // sedang dipakai.
    //
    // Sasaran konfliknya `lower(nama_pengguna)`, BUKAN kolomnya. Indeks uniknya
    // memang indeks ekspresi — `uq_pengguna_nama_pengguna ON pengguna
    // (lower(nama_pengguna))` — sehingga menyebut kolomnya saja dijawab
    // PostgreSQL dengan "no unique or exclusion constraint matching".
    const hasil = await pool.query<{ id: string }>(
      `INSERT INTO pengguna (nama_pengguna, nama, peran, kata_sandi_hash)
       VALUES ($1, $2, 'administrator', $3)
       ON CONFLICT (lower(nama_pengguna)) DO NOTHING
       RETURNING id`,
      [namaPengguna, nama, hash],
    );

    if (hasil.rowCount === 0) {
      berhenti(
        `Nama pengguna ${namaPengguna} sudah dipakai. Akun yang ada TIDAK diubah.\n` +
          `Untuk menyetel ulang kata sandinya, ulangi dengan --ganti-kata-sandi.`,
      );
    }

    console.log(`Akun Administrator dibuat: ${namaPengguna} (${nama}).`);
  }

  // Kata sandi tidak dicetak — operator sudah memegangnya, dan mencetaknya
  // hanya menambah satu tempat lagi ia dapat tertinggal.
  console.log("Gantilah kata sandinya pada masuk pertama — PATCH /api/saya/kata-sandi.");
} catch (galat) {
  berhenti(`Pembuatan gagal: ${galat instanceof Error ? galat.message : String(galat)}`);
} finally {
  await pool.end();
}
