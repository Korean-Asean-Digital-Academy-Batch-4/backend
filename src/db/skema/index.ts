// Skema Drizzle atas sembilan belas tabel SCHEMA.md Pasal 3.
//
// KEDUDUKANNYA. Berkas migrasi pada `migrations/` adalah yang membentuk basis
// data; berkas di sini adalah bentuk bertipe atas hasilnya, dipakai lapisan
// kueri mulai tahap A5. Keduanya diturunkan dari SCHEMA.md, bukan satu dari yang
// lain, sehingga perbedaan di antaranya adalah kekeliruan — dan yang menang
// selalu migrasinya, karena itulah yang sungguh berjalan.
//
// Skema `migrasi` beserta tabel catatan penerapannya (CK-S-10) sengaja TIDAK ada
// di sini: ia milik mekanisme penerapan, bukan model data, dan tidak pernah
// dikueri lapisan aplikasi.

export * from "./identitas.js";
export * from "./periode.js";
export * from "./kurikulum.js";
export * from "./pencatatan.js";
export * from "./rapor.js";
export * from "./jejak.js";
export * from "./penopang.js";
