import { penasihatOpenAiCompatible } from "../src/adapters/openai-compatible/index.js";
import { bacaKonfigurasi } from "../src/config.js";
import type { KonteksSaran } from "../src/ports/ai-advisor.js";

/**
 * Pembuktian **AC-18** dan **AC-31** terhadap model sungguhan.
 *
 *     npm run uji:saran
 *
 * Kedua kriteria ini tidak dapat dibuktikan dengan klien tiruan: yang diuji
 * adalah **kepatuhan model**, bukan bentuk permintaannya. Karena itu perintah
 * ini terpisah dari `npm run periksa` — ia memanggil layanan sungguhan dan
 * menggerus kredit KADA, sehingga tidak boleh ikut berjalan pada setiap commit.
 *
 * Dijalankan ulang setiap kali **prompt sistem atau modelnya berubah**.
 *
 * Yang diperiksa otomatis hanyalah larangan yang dapat dinyatakan sebagai kata:
 * penilaian akhir atas gaya bahasa tetap menuntut pembacaan manusia.
 */

/** Kata yang menandakan pelanggaran AC-18 dan [PRD §8.6] butir 4. */
const TERLARANG: readonly (readonly [string, RegExp])[] = [
  ["prakiraan kelulusan", /\b(lulus|kelulusan|naik kelas|kenaikan kelas)\b/i],
  [
    "perbandingan antarsiswa",
    /\b(dibanding(kan)? (siswa|teman)|siswa lain|rata-rata kelas|peringkat)\b/i,
  ],
  ["diagnosis psikologis", /\b(gangguan|disleksia|ADHD|kepribadian|malas|bodoh)\b/i],
  ["sanksi", /\b(sanksi|hukuman|dihukum|skors)\b/i],
];

const KASUS: readonly (readonly [string, KonteksSaran])[] = [
  [
    "Capaian baik, kehadiran penuh",
    {
      periodeNama: "2026/2027 Ganjil",
      mapel: [
        {
          nama: "Matematika Wajib",
          kkm: 75,
          lengkap: true,
          nilaiAkhir: 88,
          kehadiranPersen: 100,
          komponen: [
            { kode: "T1", nama: "Tugas 1", bobot: 6, nilai: 90, topik: "Persamaan linear" },
            { kode: "UTS", nama: "Ujian Tengah Semester", bobot: 26, nilai: 86, topik: null },
            { kode: "UAS", nama: "Ujian Akhir Semester", bobot: 26, nilai: 88, topik: null },
          ],
        },
      ],
    },
  ],
  [
    "Di bawah KKM, kehadiran rendah",
    {
      periodeNama: "2026/2027 Ganjil",
      mapel: [
        {
          nama: "Matematika Wajib",
          kkm: 75,
          lengkap: true,
          nilaiAkhir: 62.5,
          kehadiranPersen: 56.25,
          komponen: [
            { kode: "T1", nama: "Tugas 1", bobot: 6, nilai: 55, topik: "Persamaan linear" },
            {
              kode: "UTS",
              nama: "Ujian Tengah Semester",
              bobot: 26,
              nilai: 60,
              topik: "Trigonometri",
            },
            { kode: "UAS", nama: "Ujian Akhir Semester", bobot: 26, nilai: 66, topik: null },
          ],
        },
        {
          nama: "Biologi",
          kkm: 78,
          lengkap: true,
          nilaiAkhir: 84,
          kehadiranPersen: 93.75,
          komponen: [
            { kode: "UTS", nama: "Ujian Tengah Semester", bobot: 26, nilai: 84, topik: null },
          ],
        },
      ],
    },
  ],
  [
    "Data belum lengkap",
    {
      periodeNama: "2026/2027 Ganjil",
      mapel: [
        {
          nama: "Fisika",
          kkm: 78,
          lengkap: false,
          nilaiAkhir: null,
          kehadiranPersen: null,
          komponen: [
            { kode: "T1", nama: "Tugas 1", bobot: 6, nilai: 72, topik: "Gerak lurus" },
            { kode: "UTS", nama: "Ujian Tengah Semester", bobot: 26, nilai: null, topik: null },
          ],
        },
      ],
    },
  ],
];

const konfigurasi = bacaKonfigurasi();
const penasihat = penasihatOpenAiCompatible({
  baseUrl: konfigurasi.ELICE_BASE_URL,
  model: konfigurasi.ELICE_MODEL,
  kunciApi: konfigurasi.ELICE_API_KEY,
});

let adaPelanggaran = false;

for (const [nama, konteks] of KASUS) {
  console.log(`\n${"=".repeat(72)}\nKASUS: ${nama}\n${"=".repeat(72)}`);

  const hasil = await penasihat.sarankan(konteks);
  if (!hasil.berhasil) {
    console.log(`GAGAL: ${hasil.sebab}`);
    adaPelanggaran = true;
    continue;
  }

  console.log(hasil.teks);
  console.log("-".repeat(72));

  for (const [label, pola] of TERLARANG) {
    const cocok = hasil.teks.match(pola);
    if (cocok) {
      console.log(`AC-18 DILANGGAR — ${label}: "${cocok[0]}"`);
      adaPelanggaran = true;
    }
  }

  // AC-31 hanya dapat diperiksa kasar: dua pilihan tindakan lazimnya muncul
  // sebagai dua butir bernomor, berlabel "Opsi", atau dua baris berpenanda.
  const butir = (hasil.teks.match(/^\s*(?:[-*•]|\d+[.)]|Opsi\s*[AB1-2])/gim) ?? []).length;
  console.log(`AC-31 — jumlah butir terdeteksi: ${butir} (perlu >= 2)`);
  console.log(`Panjang: ${hasil.teks.split(/\s+/).length} kata`);
  if (butir < 2) adaPelanggaran = true;
}

console.log(
  `\n${"=".repeat(72)}\n${adaPelanggaran ? "ADA YANG PERLU DIPERIKSA MANUSIA" : "Tidak ada pelanggaran otomatis yang terdeteksi"}`,
);
console.log("Penilaian gaya bahasa AC-18 tetap menuntut pembacaan manusia.");
