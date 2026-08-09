import { parseArgs } from "node:util";

import { kataSandiArgon2id } from "../adapters/local/kata-sandi.js";
import { bacaKonfigurasi } from "../config.js";
import { buatAdministrator, gantiKataSandi } from "../db/administrator.js";
import { buatPool } from "../db/index.js";

/**
 * Perintah CLI akun Administrator — ARCHITECTURE.md §9.3.
 *
 *     npm run admin:create -- --nama-pengguna <pengenal> --nama "<nama lengkap>"
 *     npm run admin:create -- --ganti-kata-sandi --nama-pengguna <pengenal>
 *
 * Kata sandi awal dicetak ke keluaran terminal **sekali** dan tidak dapat
 * ditampilkan ulang — yang tersimpan hanya hash Argon2id-nya.
 *
 * Di AWS dijalankan dengan memanggil fungsi Lambda `migrate` yang memakai image
 * yang sama dengan argumen berbeda; di on-prem dan pengembangan, dijalankan
 * langsung di dalam container.
 */

const { values } = parseArgs({
  options: {
    "nama-pengguna": { type: "string" },
    nama: { type: "string" },
    "ganti-kata-sandi": { type: "boolean", default: false },
  },
});

function berhenti(pesan: string): never {
  console.error(pesan);
  process.exit(1);
}

// ARCHITECTURE.md sec 9.3. Runtime Lambda mengalirkan seluruh stdout ke
// CloudWatch Logs, dan itu tidak dapat dimatikan dari dalam aplikasi. Mencetak
// kata sandi di sana berarti menyimpannya sebagai teks polos selama retensi log
// — terbaca siapa pun yang memegang hak baca CloudWatch, tanpa perlu menyentuh
// basis data. Jaminan "tidak dapat ditampilkan ulang" tidak berlaku di sana,
// sehingga perintahnya berhenti alih-alih diam-diam membocorkannya.
if (process.env["AWS_LAMBDA_FUNCTION_NAME"]) {
  berhenti(
    "Perintah ini menolak berjalan di dalam Lambda: seluruh keluarannya mengalir ke " +
      "CloudWatch Logs, sehingga kata sandi awal akan tersimpan sebagai teks polos. " +
      "Cara membuat Administrator pertama di AWS belum diputuskan — lihat ARCHITECTURE.md sec 9.3.",
  );
}

const namaPengguna = values["nama-pengguna"];
if (!namaPengguna) {
  berhenti("Wajib menyebut --nama-pengguna.");
}

const pool = buatPool(bacaKonfigurasi());
const kataSandi = kataSandiArgon2id();

try {
  const hasil = values["ganti-kata-sandi"]
    ? await gantiKataSandi(pool, kataSandi, namaPengguna)
    : await buatAdministrator(pool, kataSandi, namaPengguna, values.nama ?? namaPengguna);

  if (!hasil.berhasil) {
    berhenti(hasil.sebab);
  }

  const tindakan = values["ganti-kata-sandi"] ? "Kata sandi diganti" : "Akun Administrator dibuat";
  console.log(`${tindakan}: ${namaPengguna}`);
  console.log(`Kata sandi: ${hasil.kataSandiAwal}`);
  console.log("Ditampilkan sekali. Serahkan kepada pemiliknya, lalu hapus dari layar ini.");
} finally {
  await pool.end();
}
