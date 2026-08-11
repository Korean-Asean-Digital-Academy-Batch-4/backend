/**
 * Peran proses — CK-D-08.
 *
 * Kedua fungsi Lambda menjalankan image dan perintah yang **sama persis**. Yang
 * membedakannya satu variabel lingkungan, dan pemilihan itu berhenti di sini.
 *
 * Bukan `image_config` pada Terraform, karena `image_config` adalah bagian dari
 * cangkang yang berlaku bagi image mana pun yang sedang terpasang — termasuk
 * `:bootstrap` yang dipakai saat fungsi dibuat. Perintah yang menunjuk berkas
 * milik image aplikasi membuat fungsi `migrate` gagal menyala pada `terraform
 * apply` pertama, sebelum ada satu pun rilis.
 *
 * Bukan pula entry point kedua: [ARCHITECTURE.md §5.1] menyatakan `entry/`
 * tidak memiliki entry point terpisah untuk AWS, karena AWS menjalankan
 * container yang sama dengan on-prem.
 */

export const PERAN_SAH = ["api", "migrasi"] as const;

export type Peran = (typeof PERAN_SAH)[number];

export function bacaPeran(env: NodeJS.ProcessEnv = process.env): Peran {
  const nilai = env.PERAN ?? "api";

  if (!(PERAN_SAH as readonly string[]).includes(nilai)) {
    throw new Error(`PERAN tidak dikenal: ${JSON.stringify(nilai)}. Nilai yang sah: api, migrasi.`);
  }

  return nilai as Peran;
}
