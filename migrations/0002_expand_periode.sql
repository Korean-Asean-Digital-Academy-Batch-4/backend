-- migrasi : 0002
-- jenis   : additive
-- mundur  : ya — hanya membuat tabel baru, rilis sebelumnya tidak mengenalnya
-- dibaca  : api, migrate, app_ro
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 4.2. Jenjang dibatasi X, XI, dan XII: sekolah menyatakan pada
-- 7 Agustus 2026 bahwa MVP mencakup jenjang SMA saja (temuan S-04, ditutup).

CREATE TABLE tahun_ajaran (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    nama        text    NOT NULL,
    tgl_mulai   date    NOT NULL,
    tgl_selesai date    NOT NULL,
    aktif       boolean NOT NULL DEFAULT false,

    CONSTRAINT uq_tahun_ajaran_nama    UNIQUE (nama),
    CONSTRAINT ck_tahun_ajaran_rentang CHECK (tgl_selesai > tgl_mulai)
);

CREATE TABLE periode (
    id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    tahun_ajaran_ref uuid    NOT NULL REFERENCES tahun_ajaran (id) ON DELETE RESTRICT,
    semester         text    NOT NULL,
    tgl_mulai        date    NOT NULL,
    tgl_selesai      date    NOT NULL,
    aktif            boolean NOT NULL DEFAULT false,

    CONSTRAINT uq_periode_tahun_semester UNIQUE (tahun_ajaran_ref, semester),
    CONSTRAINT ck_periode_semester       CHECK (semester IN ('ganjil', 'genap')),
    CONSTRAINT ck_periode_rentang        CHECK (tgl_selesai > tgl_mulai)
);

-- I-03: satu tahun ajaran memiliki paling banyak satu semester aktif
CREATE UNIQUE INDEX uq_periode_aktif_per_tahun ON periode (tahun_ajaran_ref) WHERE aktif;

CREATE TABLE kelas (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    periode_ref    uuid        NOT NULL REFERENCES periode (id) ON DELETE RESTRICT,
    nama           text        NOT NULL,
    tingkat        text        NOT NULL,
    jurusan        text,
    wali_kelas_ref uuid        REFERENCES guru (pengguna_ref) ON DELETE RESTRICT,
    dibuat_pada    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_kelas_periode_nama UNIQUE (periode_ref, nama),
    CONSTRAINT uq_kelas_id_tingkat   UNIQUE (id, tingkat),
    CONSTRAINT uq_kelas_id_periode   UNIQUE (id, periode_ref),
    CONSTRAINT ck_kelas_tingkat      CHECK (tingkat IN ('X', 'XI', 'XII')),
    CONSTRAINT ck_kelas_nama         CHECK (length(nama) BETWEEN 1 AND 32)
);

-- aktor-role sec 12 butir 1, terjawab 7 Agustus 2026: satu Guru menjadi wali
-- paling banyak satu kelas per periode
CREATE UNIQUE INDEX uq_kelas_wali_per_periode
    ON kelas (periode_ref, wali_kelas_ref) WHERE wali_kelas_ref IS NOT NULL;

CREATE TABLE kelas_siswa (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    kelas_ref   uuid        NOT NULL,
    siswa_ref   uuid        NOT NULL REFERENCES siswa (pengguna_ref) ON DELETE RESTRICT,
    periode_ref uuid        NOT NULL,
    dibuat_pada timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_kelas_siswa_kelas FOREIGN KEY (kelas_ref, periode_ref)
        REFERENCES kelas (id, periode_ref) ON DELETE RESTRICT,
    CONSTRAINT uq_kelas_siswa_periode UNIQUE (siswa_ref, periode_ref),
    CONSTRAINT uq_kelas_siswa_kelas   UNIQUE (kelas_ref, siswa_ref)
);

CREATE INDEX idx_kelas_siswa_kelas ON kelas_siswa (kelas_ref);
