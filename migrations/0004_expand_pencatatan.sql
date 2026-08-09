-- migrasi : 0004
-- jenis   : additive
-- mundur  : ya — hanya membuat tabel baru, rilis sebelumnya tidak mengenalnya
-- dibaca  : api, migrate, app_ro
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 4.4. nilai.nilai bersifat NOT NULL, dan inilah penegakan I-12:
-- "belum lengkap" memiliki satu representasi tunggal, yaitu ketiadaan baris.
-- ON DELETE CASCADE dari sesi ke presensi adalah satu-satunya cascade pada data
-- akademik (I-16, AC-25); selebihnya RESTRICT.

CREATE TABLE nilai (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    penugasan_ref   uuid         NOT NULL REFERENCES penugasan (id) ON DELETE RESTRICT,
    komponen_ref    uuid         NOT NULL REFERENCES komponen_penilaian (id) ON DELETE RESTRICT,
    siswa_ref       uuid         NOT NULL REFERENCES siswa (pengguna_ref) ON DELETE RESTRICT,
    nilai           numeric(5,2) NOT NULL,
    diperbarui_oleh uuid         NOT NULL REFERENCES pengguna (id) ON DELETE RESTRICT,
    dibuat_pada     timestamptz  NOT NULL DEFAULT now(),
    diperbarui_pada timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT uq_nilai         UNIQUE (penugasan_ref, komponen_ref, siswa_ref),
    CONSTRAINT ck_nilai_rentang CHECK (nilai >= 0 AND nilai <= 100)
);

CREATE INDEX idx_nilai_penugasan_siswa ON nilai (penugasan_ref, siswa_ref);
CREATE INDEX idx_nilai_siswa           ON nilai (siswa_ref);

CREATE TABLE sesi (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    penugasan_ref uuid        NOT NULL REFERENCES penugasan (id) ON DELETE RESTRICT,
    tanggal       date        NOT NULL,
    dibuka_oleh   uuid        NOT NULL REFERENCES pengguna (id) ON DELETE RESTRICT,
    dibuat_pada   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_sesi_penugasan_tanggal UNIQUE (penugasan_ref, tanggal)
);

CREATE TABLE presensi (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    sesi_ref        uuid        NOT NULL REFERENCES sesi (id) ON DELETE CASCADE,
    siswa_ref       uuid        NOT NULL REFERENCES siswa (pengguna_ref) ON DELETE RESTRICT,
    status          text        NOT NULL DEFAULT 'alpa',
    catatan         text,
    diperbarui_oleh uuid        NOT NULL REFERENCES pengguna (id) ON DELETE RESTRICT,
    diperbarui_pada timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_presensi         UNIQUE (sesi_ref, siswa_ref),
    CONSTRAINT ck_presensi_status  CHECK (status IN ('hadir', 'izin', 'sakit', 'alpa')),
    CONSTRAINT ck_presensi_catatan CHECK (catatan IS NULL OR length(catatan) <= 200)
);

CREATE INDEX idx_presensi_siswa ON presensi (siswa_ref);
