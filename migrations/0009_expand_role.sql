-- migrasi : 0009
-- jenis   : additive
-- mundur  : ya — hanya memberikan hak, tidak mencabut satu pun hak yang dipakai rilis sebelumnya
-- dibaca  : api, migrate, app_ro
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md Pasal 7. Ditulis tangan: Drizzle tidak membangkitkan GRANT.
-- edutrack_owner TIDAK dibuat di sini — ia yang menjalankan migrasi ini.

-- CK-S-09. Tanpa kata sandi: nilainya ditetapkan di luar migrasi (Techstack sec 7
-- butir 1), sehingga tidak ada satu pun kata sandi di dalam repositori. Penjaga
-- IF NOT EXISTS diperlukan karena role bersifat lintas basis data dalam satu
-- cluster, bukan milik satu basis data.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
        CREATE ROLE app_rw LOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
        CREATE ROLE app_ro LOGIN;
    END IF;
END
$$;

-- Tidak ada hak apa pun yang diberikan secara diam-diam
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_rw, app_ro;

-- Jalur tulis aplikasi
GRANT SELECT, INSERT, UPDATE, DELETE ON
    pengguna, guru, siswa,
    tahun_ajaran, periode, kelas, kelas_siswa,
    mapel, penugasan, komponen_penilaian, penugasan_komponen,
    nilai, sesi, presensi,
    rapor, rapor_mapel,
    sesi_masuk, pembatas_laju
TO app_rw;
GRANT SELECT, INSERT ON audit_log TO app_rw;

-- Jalur AI: hanya membaca, dan hanya yang diperlukan menyusun prompt
GRANT SELECT ON
    nilai, presensi, sesi,
    mapel, penugasan, penugasan_komponen, komponen_penilaian,
    kelas, kelas_siswa, periode, tahun_ajaran
TO app_ro;
-- TIDAK ADA INSERT, UPDATE, maupun DELETE. Sama sekali.

-- Tabel yang tidak disebutkan tetap tertutup bagi app_ro:
--   pengguna, guru, siswa      -> identitas
--   rapor, rapor_mapel         -> di luar cakupan tombol Suggestion
--   audit_log, sesi_masuk, pembatas_laju

-- Setiap tabel baru tertutup bagi jalur AI sampai diberikan secara sadar.
-- Tidak ada default privilege bagi app_ro — SCHEMA.md sec 7.2.
ALTER DEFAULT PRIVILEGES FOR ROLE edutrack_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
