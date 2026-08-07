-- migrasi : 0005
-- jenis   : additive
-- mundur  : ya — hanya membuat tabel baru, rilis sebelumnya tidak mengenalnya
-- dibaca  : api, migrate
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 4.5. Dua CHECK konsistensi status menutup celah yang tidak
-- terlihat: rapor final tanpa pertanggungjawaban siapa dan kapan, dan waktu
-- distribusi pada rapor yang belum didistribusikan.

CREATE TABLE rapor (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    siswa_ref            uuid        NOT NULL REFERENCES siswa (pengguna_ref) ON DELETE RESTRICT,
    kelas_ref            uuid        NOT NULL,
    periode_ref          uuid        NOT NULL,
    status               text        NOT NULL DEFAULT 'draft',
    catatan_wali         text,
    difinalisasi_oleh    uuid        REFERENCES pengguna (id) ON DELETE RESTRICT,
    difinalisasi_pada    timestamptz,
    didistribusikan_pada timestamptz,
    kunci_berkas         text,
    dibuat_pada          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_rapor_kelas FOREIGN KEY (kelas_ref, periode_ref)
        REFERENCES kelas (id, periode_ref) ON DELETE RESTRICT,
    CONSTRAINT uq_rapor_siswa_periode UNIQUE (siswa_ref, periode_ref),
    CONSTRAINT ck_rapor_status  CHECK (status IN ('draft', 'finalized', 'distributed')),
    CONSTRAINT ck_rapor_catatan CHECK (catatan_wali IS NULL OR length(catatan_wali) <= 1000),
    CONSTRAINT ck_rapor_finalisasi CHECK (
        (status = 'draft'
            AND difinalisasi_pada IS NULL AND difinalisasi_oleh IS NULL)
        OR (status <> 'draft'
            AND difinalisasi_pada IS NOT NULL AND difinalisasi_oleh IS NOT NULL)
    ),
    CONSTRAINT ck_rapor_distribusi CHECK (
        (status = 'distributed') = (didistribusikan_pada IS NOT NULL)
    )
);

CREATE INDEX idx_rapor_kelas ON rapor (kelas_ref);

CREATE TABLE rapor_mapel (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    rapor_ref         uuid         NOT NULL REFERENCES rapor (id) ON DELETE CASCADE,
    mapel_nama        text         NOT NULL,
    kkm               smallint     NOT NULL,
    nilai_akhir       numeric(5,2) NOT NULL,
    kehadiran_persen  numeric(5,2) NOT NULL,
    snapshot_komponen jsonb        NOT NULL,

    CONSTRAINT uq_rapor_mapel       UNIQUE (rapor_ref, mapel_nama),
    CONSTRAINT ck_rapor_mapel_kkm   CHECK (kkm BETWEEN 0 AND 100),
    CONSTRAINT ck_rapor_mapel_nilai CHECK (nilai_akhir BETWEEN 0 AND 100),
    CONSTRAINT ck_rapor_mapel_hadir CHECK (kehadiran_persen BETWEEN 0 AND 100),
    CONSTRAINT ck_rapor_mapel_snapshot CHECK (jsonb_typeof(snapshot_komponen) = 'array')
);
