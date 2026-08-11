import type { KonteksSaran, MapelKonteks } from "../../ports/ai-advisor.js";

/**
 * Penyusunan prompt — [ARCHITECTURE.md §10.1].
 *
 * Murni: masuk konteks, keluar teks. Dapat diuji tanpa menyentuh jaringan,
 * dan itulah yang membuat AC-18 dan AC-31 dapat diperiksa sebagian tanpa model
 * sungguhan.
 *
 * **Larangan pada [PRD §8.6] dinyatakan di sini, tetapi tidak disandarkan
 * padanya.** Yang benar-benar mengikat ditegakkan arsitektur: AI tidak dapat
 * mengubah data karena koneksinya tanpa hak tulis (butir 2 dan 3), dan tidak
 * dapat membaca siswa lain karena kuerinya sudah dibatasi sebelum prompt
 * disusun (butir 6). Prompt sistem hanya mengurus butir 1, 4, dan 5 — yaitu
 * yang tidak dapat ditegakkan siapa pun selain modelnya sendiri.
 */

/**
 * Prompt sistem.
 *
 * Ketiga unsur wajib AC-31 disebut sebagai keluaran, bukan sebagai saran.
 * Larangan AC-18 disebut dengan kata kerja yang tegas, karena model penalaran
 * cenderung menawar batasan yang ditulis lunak.
 */
export const PROMPT_SISTEM = [
  "Anda adalah konsultan pendidikan yang menulis untuk seorang siswa SMA.",
  "Tulis dalam Bahasa Indonesia yang profesional, hangat, dan lugas.",
  "",
  "Keluaran Anda WAJIB memuat tiga hal:",
  "1. Rekomendasi belajar yang konkret.",
  "2. Alasan rekomendasi itu, dikaitkan dengan angka yang diberikan.",
  "3. Tepat dua pilihan tindakan yang realistis dikerjakan seorang siswa.",
  "",
  "Bentuknya: satu paragraf rekomendasi, lalu poin-poin ringkas.",
  "Panjang seluruhnya paling banyak sekitar 200 kata.",
  "",
  "Yang DILARANG:",
  "- Memperkirakan kelulusan, kenaikan kelas, atau peluang diterima di mana pun.",
  "- Membandingkan siswa ini dengan siswa lain, kelas lain, atau rata-rata apa pun.",
  "- Memberi diagnosis psikologis, menilai kepribadian, atau menyarankan sanksi.",
  "- Menghitung ulang, mengoreksi, atau menyebut angka selain yang diberikan.",
  "- Menyebut nilai akhir suatu mata pelajaran yang datanya belum lengkap.",
  "",
  "Presensi dipakai sebagai fakta penjelas, bukan sebagai peringatan.",
  "Sebutkan kehadiran hanya bila ia membantu menjelaskan capaian.",
  "Jangan meminta data tambahan, dan jangan mengajukan pertanyaan balik.",
].join("\n");

const TANPA_NILAI = "belum diisi";

function barisKomponen(mapel: MapelKonteks): string[] {
  return mapel.komponen.map((satu) => {
    const nilai = satu.nilai === null ? TANPA_NILAI : satu.nilai.toFixed(2);
    const topik = satu.topik === null ? "" : ` — topik: ${satu.topik}`;
    return `    - ${satu.nama} (${satu.kode}, bobot ${satu.bobot}%): ${nilai}${topik}`;
  });
}

function bagianMapel(mapel: MapelKonteks): string[] {
  const kehadiran =
    mapel.kehadiranPersen === null
      ? "belum ada sesi presensi"
      : `${mapel.kehadiranPersen.toFixed(2)}%`;

  // Nilai akhir sengaja TIDAK dicantumkan ketika komponennya belum lengkap —
  // [PRD §8.6] butir 5. Yang dikirim adalah keadaannya, bukan angka pengganti.
  const akhir =
    mapel.nilaiAkhir === null
      ? "belum dapat dihitung karena komponennya belum lengkap"
      : mapel.nilaiAkhir.toFixed(2);

  return [
    `- ${mapel.nama}`,
    `    KKM: ${mapel.kkm}`,
    `    Nilai akhir: ${akhir}`,
    `    Kehadiran: ${kehadiran}`,
    ...barisKomponen(mapel),
  ];
}

/** Bagian `user` pada pesan — seluruhnya angka dan nama mata pelajaran. */
export function susunPesanPengguna(konteks: KonteksSaran): string {
  return [
    `Periode: ${konteks.periodeNama}`,
    "",
    "Capaian per mata pelajaran:",
    ...konteks.mapel.flatMap(bagianMapel),
    "",
    "Susun rangkuman capaian beserta rekomendasi belajarnya.",
  ].join("\n");
}
