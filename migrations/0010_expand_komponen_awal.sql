-- migrasi : 0010
-- jenis   : additive
-- mundur  : ya — hanya menyisipkan baris templat, tidak mengubah bentuk apa pun
-- dibaca  : api, migrate, app_ro
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 9.2. Wajib berada SETELAH 0008: trg_komponen_bobot menolak
-- keadaan akhir transaksi yang jumlahnya bukan 100, sehingga penyisipan delapan
-- baris dalam satu transaksi lolos sedangkan penyisipan sebagian tidak.
--
-- Angka ini belum divalidasi sekolah (V1, T-06). Karena komponen disimpan
-- sebagai baris dan bukan kolom (D-01), hasil validasi yang mengubah jumlah
-- maupun bobotnya adalah PERUBAHAN DATA, bukan migrasi skema.

INSERT INTO komponen_penilaian (kode, nama, bobot, urutan) VALUES
    ('T1',  'Tugas 1',                6, 1),
    ('T2',  'Tugas 2',                6, 2),
    ('T3',  'Tugas 3',                6, 3),
    ('U1',  'Ulangan Harian 1',      10, 4),
    ('U2',  'Ulangan Harian 2',      10, 5),
    ('U3',  'Ulangan Harian 3',      10, 6),
    ('UTS', 'Ujian Tengah Semester', 26, 7),
    ('UAS', 'Ujian Akhir Semester',  26, 8);
-- 6x3 + 10x3 + 26 + 26 = 100
