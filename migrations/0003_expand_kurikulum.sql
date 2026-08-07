-- migrasi : 0003
-- jenis   : additive
-- mundur  : ya — hanya membuat tabel baru, rilis sebelumnya tidak mengenalnya
-- dibaca  : api, migrate, app_ro
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 4.3. Tiga composite foreign key pada penugasan adalah inti
-- skema: jenjang yang tidak cocok (I-06, AC-24) dan guru yang bukan pengampu
-- (I-07) menjadi mustahil tersimpan, tanpa bergantung pada satu baris kode pun.

CREATE TABLE mapel (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    kode            text        NOT NULL,
    nama            text        NOT NULL,
    tingkat         text        NOT NULL,
    kkm             smallint    NOT NULL DEFAULT 75,
    guru_ref        uuid        NOT NULL REFERENCES guru (pengguna_ref) ON DELETE RESTRICT,
    dibuat_pada     timestamptz NOT NULL DEFAULT now(),
    diperbarui_pada timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_mapel_kode       UNIQUE (kode),
    CONSTRAINT uq_mapel_guru       UNIQUE (guru_ref),
    CONSTRAINT uq_mapel_id_tingkat UNIQUE (id, tingkat),
    CONSTRAINT uq_mapel_id_guru    UNIQUE (id, guru_ref),
    CONSTRAINT ck_mapel_tingkat    CHECK (tingkat IN ('X', 'XI', 'XII')),
    CONSTRAINT ck_mapel_kkm        CHECK (kkm BETWEEN 0 AND 100),
    CONSTRAINT ck_mapel_nama       CHECK (length(nama) BETWEEN 1 AND 64)
);

CREATE TABLE penugasan (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    guru_ref    uuid        NOT NULL,
    mapel_ref   uuid        NOT NULL,
    kelas_ref   uuid        NOT NULL,
    tingkat     text        NOT NULL,
    dibuat_pada timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_penugasan_mapel_tingkat FOREIGN KEY (mapel_ref, tingkat)
        REFERENCES mapel (id, tingkat) ON DELETE RESTRICT,
    CONSTRAINT fk_penugasan_kelas_tingkat FOREIGN KEY (kelas_ref, tingkat)
        REFERENCES kelas (id, tingkat) ON DELETE RESTRICT,
    CONSTRAINT fk_penugasan_mapel_guru FOREIGN KEY (mapel_ref, guru_ref)
        REFERENCES mapel (id, guru_ref) ON DELETE RESTRICT,
    CONSTRAINT uq_penugasan_kelas_mapel UNIQUE (kelas_ref, mapel_ref)
);

CREATE INDEX idx_penugasan_guru  ON penugasan (guru_ref);
CREATE INDEX idx_penugasan_kelas ON penugasan (kelas_ref);

CREATE TABLE komponen_penilaian (
    id     uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    kode   text     NOT NULL,
    nama   text     NOT NULL,
    bobot  smallint NOT NULL,
    urutan smallint NOT NULL,

    CONSTRAINT uq_komponen_kode   UNIQUE (kode),
    CONSTRAINT uq_komponen_urutan UNIQUE (urutan),
    CONSTRAINT ck_komponen_bobot  CHECK (bobot > 0 AND bobot <= 100)
);

CREATE TABLE penugasan_komponen (
    penugasan_ref uuid NOT NULL REFERENCES penugasan (id) ON DELETE RESTRICT,
    komponen_ref  uuid NOT NULL REFERENCES komponen_penilaian (id) ON DELETE RESTRICT,
    topik         text,

    CONSTRAINT pk_penugasan_komponen PRIMARY KEY (penugasan_ref, komponen_ref),
    CONSTRAINT ck_penugasan_komponen_topik CHECK (topik IS NULL OR length(topik) <= 200)
);
