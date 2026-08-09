import { kataSandiArgon2id } from "../adapters/local/kata-sandi.js";
import { bacaKonfigurasi } from "../config.js";
import { buatAdministrator, gantiKataSandi } from "../db/administrator.js";
import { buatPool } from "../db/index.js";
import { PANJANG_MAKSIMUM, bacaKataSandi } from "./kata-sandi-masukan.js";

/**
 * Administrator pertama — ARCHITECTURE.md §9.3, CK-A-09.
 *
 *     printf '%s' '<kata sandi>' | npm run seed:admin -- <pengenal> "<nama lengkap>"
 *     npm run seed:admin -- <pengenal> "<nama lengkap>"        # meminta di terminal
 *     npm run seed:admin -- <pengenal> "<nama lengkap>" --ganti-kata-sandi
 *
 * Kata sandi **tidak pernah menjadi argumen proses**: argumen terbaca pengguna
 * lain lewat `/proc/<pid>/cmdline` dan tersimpan pada riwayat shell. Perintah
 * ini juga tidak mencetak kata sandi, karena operator sudah mengetahuinya.
 *
 * Untuk reset kata sandi sesudah sistem berjalan, pakai `admin:create` yang
 * membangkitkan kata sandi sesuai P17.
 */

function berhenti(pesan: string): never {
  console.error(pesan);
  process.exit(1);
}

const argumen = process.argv.slice(2);
const ganti = argumen.includes("--ganti-kata-sandi");
const posisi = argumen.filter((satu) => !satu.startsWith("--"));
const namaPengguna = posisi[0];
const nama = posisi[1];

if (!namaPengguna) {
  berhenti('Pemakaian: npm run seed:admin -- <pengenal> "<nama lengkap>" [--ganti-kata-sandi]');
}

const kataSandiPolos = await bacaKataSandi("Kata sandi: ");

if (kataSandiPolos.length === 0) {
  berhenti("Kata sandi kosong. Salurkan lewat stdin, atau ketikkan saat diminta.");
}
if (kataSandiPolos.length > PANJANG_MAKSIMUM) {
  berhenti(`Kata sandi melampaui ${PANJANG_MAKSIMUM} aksara.`);
}

const pool = buatPool(bacaKonfigurasi());
const kataSandi = kataSandiArgon2id();

try {
  const hasil = ganti
    ? await gantiKataSandi(pool, kataSandi, namaPengguna, kataSandiPolos)
    : await buatAdministrator(pool, kataSandi, namaPengguna, nama ?? namaPengguna, kataSandiPolos);

  if (!hasil.berhasil) {
    berhenti(hasil.sebab);
  }

  // Kata sandi TIDAK dicetak. Operator sudah memegangnya, dan mencetaknya
  // hanya menambah satu tempat lagi ia dapat tertinggal.
  console.log(
    ganti
      ? `Kata sandi ${namaPengguna} diganti.`
      : `Akun Administrator dibuat: ${namaPengguna} (${nama ?? namaPengguna}).`,
  );
} finally {
  await pool.end();
}
