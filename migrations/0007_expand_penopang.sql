-- migrasi : 0007
-- jenis   : additive
-- mundur  : ya — hanya membuat tabel baru, rilis sebelumnya tidak mengenalnya
-- dibaca  : api, migrate
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 4.7. Yang disimpan adalah hash token, bukan tokennya, sehingga
-- salinan basis data mana pun tidak memuat satu sesi pun yang dapat dipakai
-- masuk (CK-S-06). pembatas_laju dibersihkan sendiri tanpa pekerjaan latar (CK-07).

CREATE TABLE sesi_masuk (
    token_hash       text        PRIMARY KEY,
    pengguna_ref     uuid        NOT NULL REFERENCES pengguna (id) ON DELETE CASCADE,
    dibuat_pada      timestamptz NOT NULL DEFAULT now(),
    kedaluwarsa_pada timestamptz NOT NULL,

    CONSTRAINT ck_sesi_masuk_umur CHECK (kedaluwarsa_pada > dibuat_pada)
);

CREATE INDEX idx_sesi_masuk_pengguna    ON sesi_masuk (pengguna_ref);
CREATE INDEX idx_sesi_masuk_kedaluwarsa ON sesi_masuk (kedaluwarsa_pada);

CREATE TABLE pembatas_laju (
    kunci         text        NOT NULL,
    jendela_mulai timestamptz NOT NULL,
    jumlah        integer     NOT NULL DEFAULT 0,

    CONSTRAINT pk_pembatas_laju PRIMARY KEY (kunci, jendela_mulai),
    CONSTRAINT ck_pembatas_laju_jumlah CHECK (jumlah >= 0)
);
