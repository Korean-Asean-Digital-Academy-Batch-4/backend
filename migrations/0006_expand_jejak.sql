-- migrasi : 0006
-- jenis   : additive
-- mundur  : ya — hanya membuat tabel baru, rilis sebelumnya tidak mengenalnya
-- dibaca  : api, migrate
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 4.6. Tabel ini dibangun tetapi TIDAK DITULIS sepanjang MVP
-- (CK-A-06). Ia tetap dibangun karena RFC-001 D-07 masih mempertahankannya:
-- membangunnya sekarang berbiaya nol pada basis data kosong, membangunnya kelak
-- berarti migrasi pada basis data berisi data sekolah.

CREATE TABLE audit_log (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    pengguna_ref uuid        NOT NULL REFERENCES pengguna (id) ON DELETE RESTRICT,
    judul        text        NOT NULL,
    deskripsi    text,
    aksi         text        NOT NULL,
    entitas      text        NOT NULL,
    entitas_ref  uuid,
    sebelum      jsonb,
    sesudah      jsonb,
    severity     text        NOT NULL,
    alamat_ip    inet,
    dibuat_pada  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_audit_severity CHECK (severity IN ('success', 'warning', 'failed'))
);

CREATE INDEX idx_audit_log_waktu ON audit_log (dibuat_pada DESC);
