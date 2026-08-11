/**
 * Port rahasia — [ARCHITECTURE.md §12.1].
 *
 * Keempat rahasia infrastruktur beserta tempat penyimpanannya ditetapkan
 * [Techstack.md §7]; yang menjadi urusan port ini hanyalah **jalur
 * pembacaannya**. Dua implementasi: `adapters/aws/` membaca dari Secrets
 * Manager dan SSM Parameter Store, `adapters/local/` membaca dari variabel
 * lingkungan. Perbedaan antara AWS dan on-prem dengan demikian tidak pernah
 * menyentuh kode aplikasi.
 *
 * **Yang dikembalikan adalah nilai yang siap dipakai, bukan bentuk simpanannya.**
 * Di Secrets Manager kredensial basis data tersimpan sebagai `{username,
 * password}` (CK-D-05) dan alamat instance-nya berada di variabel lingkungan,
 * sedangkan di lokal keduanya sudah menyatu menjadi satu URL. Penyusunan itu
 * urusan adapter; pemanggilnya hanya mengenal URL.
 *
 * **Dibaca sekali pada saat container menyala**, bukan pada setiap request
 * ([Techstack.md §7] butir 3). Yang menjamin hal itu adalah tempat
 * pemanggilannya — `entry/` — bukan lapisan cache di dalam adapter.
 */

/** Ketiga role basis data [ARCHITECTURE.md §8], termasuk pemilik skema. */
export const PERAN_BASIS_DATA = ["app_rw", "app_ro", "owner"] as const;

export type PeranBasisData = (typeof PERAN_BASIS_DATA)[number];

export interface Rahasia {
  /**
   * URL koneksi PostgreSQL bagi satu role.
   *
   * Peran `owner` hanya boleh diminta perintah migrasi. Di AWS pembatasan itu
   * ditegakkan IAM ([DEPLOYMENT.md §9.5]): role eksekusi fungsi `api` tidak
   * dapat membaca rahasianya sekalipun kodenya mencoba.
   */
  urlBasisData(peran: PeranBasisData): Promise<string>;

  /** Kunci API layanan AI — [Techstack.md §6]. */
  kunciApiAi(): Promise<string>;
}
