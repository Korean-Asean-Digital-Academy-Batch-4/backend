/**
 * Kegagalan bisnis yang dapat diterjemahkan lapisan rute menjadi katalog API.
 * Galat basis data dan galat tak terduga tidak masuk union ini agar tetap
 * mencapai penangan galat 500 yang menyamarkan rinciannya.
 */
export type JenisGalatAdministrasi =
  | "tidak_ditemukan"
  | "data_sudah_ada"
  | "guru_sudah_mengampu"
  | "guru_belum_mengampu"
  | "komponen_sudah_dipakai"
  | "jenjang_tidak_cocok"
  | "bobot_tidak_seratus"
  | "berkas_tidak_sah";

/** Hasil operasi administrasi yang dapat dipetakan langsung ke respons API. */
export type HasilAdministrasi<T> =
  | Readonly<{ berhasil: true; data: T }>
  | Readonly<{
      berhasil: false;
      jenis: JenisGalatAdministrasi;
      pesan: string;
      rincian?: readonly unknown[];
    }>;
