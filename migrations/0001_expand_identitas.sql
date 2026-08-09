-- migrasi : 0001
-- jenis   : additive
-- mundur  : ya — hanya membuat tabel baru, rilis sebelumnya tidak mengenalnya
-- dibaca  : api, migrate
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 4.1. Kolom `peran` pada guru dan siswa tidak menyimpan informasi
-- baru; ia menjadi bagian kedua composite foreign key ke pengguna (id, peran),
-- sehingga siswa yang ditetapkan sebagai guru pengampu mustahil tersimpan (CK-S-04).

CREATE TABLE pengguna (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_pengguna   text        NOT NULL,
    nama            text        NOT NULL,
    peran           text        NOT NULL,
    kata_sandi_hash text        NOT NULL,
    aktif           boolean     NOT NULL DEFAULT true,
    dibuat_pada     timestamptz NOT NULL DEFAULT now(),
    diperbarui_pada timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_pengguna_id_peran      UNIQUE (id, peran),
    CONSTRAINT ck_pengguna_peran         CHECK (peran IN ('administrator', 'guru', 'siswa')),
    CONSTRAINT ck_pengguna_nama_pengguna CHECK (length(nama_pengguna) BETWEEN 1 AND 32),
    CONSTRAINT ck_pengguna_nama          CHECK (length(nama) BETWEEN 1 AND 128)
);

-- I-02: pengenal masuk unik lintas seluruh pengguna, tidak peka huruf besar-kecil
CREATE UNIQUE INDEX uq_pengguna_nama_pengguna ON pengguna (lower(nama_pengguna));

CREATE TABLE guru (
    pengguna_ref uuid PRIMARY KEY,
    peran        text NOT NULL DEFAULT 'guru',

    CONSTRAINT ck_guru_peran    CHECK (peran = 'guru'),
    CONSTRAINT fk_guru_pengguna FOREIGN KEY (pengguna_ref, peran)
        REFERENCES pengguna (id, peran) ON DELETE RESTRICT
);

CREATE TABLE siswa (
    pengguna_ref uuid PRIMARY KEY,
    peran        text NOT NULL DEFAULT 'siswa',

    CONSTRAINT ck_siswa_peran    CHECK (peran = 'siswa'),
    CONSTRAINT fk_siswa_pengguna FOREIGN KEY (pengguna_ref, peran)
        REFERENCES pengguna (id, peran) ON DELETE RESTRICT
);
