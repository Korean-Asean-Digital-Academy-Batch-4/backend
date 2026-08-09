-- migrasi : 0008
-- jenis   : additive
-- mundur  : ya — pemicu hanya menolak keadaan yang memang sudah dilarang dokumen, sehingga rilis sebelumnya tidak menghasilkannya
-- dibaca  : api, migrate
-- penutup : —

-- Batas kunci dan batas pernyataan — lapis 2 DEPLOYMENT.md sec 6.5. Rilis
-- menunggu migrasi selesai (sec 3.3 langkah 6), sehingga migrasi yang menggantung
-- menahan seluruh rilis sambil memegang kunci. Lebih baik gagal cepat dan diulang.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- SCHEMA.md sec 5.2 dan CK-S-05. Ditulis tangan: Drizzle tidak membangkitkan
-- pemicu, tetapi migrasinya memang berupa SQL yang dapat dibaca dan ditinjau.
-- Keduanya MENAMBAH penegakan, bukan mengganti validasi aplikasi — validasi
-- tetap ada dan tetap menjadi penghasil pesan bagi pengguna.

-- I-10: jumlah bobot seluruh komponen penilaian tepat 100
CREATE FUNCTION jaga_jumlah_bobot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    total integer;
BEGIN
    SELECT coalesce(sum(bobot), 0) INTO total FROM komponen_penilaian;
    IF total <> 100 THEN
        RAISE EXCEPTION 'Jumlah bobot komponen penilaian harus tepat 100, saat ini %', total
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

-- DEFERRABLE INITIALLY DEFERRED adalah bagian yang menentukan. Penyesuaian bobot
-- selalu menyentuh beberapa baris sekaligus; pemeriksaan per baris akan menolak
-- langkah pertama dari perubahan yang sah.
CREATE CONSTRAINT TRIGGER trg_komponen_bobot
    AFTER INSERT OR UPDATE OR DELETE ON komponen_penilaian
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION jaga_jumlah_bobot();

-- I-21: status rapor hanya bergerak maju
CREATE FUNCTION urutan_status_rapor(s text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE s WHEN 'draft' THEN 1 WHEN 'finalized' THEN 2 WHEN 'distributed' THEN 3 END;
$$;

CREATE FUNCTION cegah_status_mundur() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF urutan_status_rapor(NEW.status) < urutan_status_rapor(OLD.status) THEN
        RAISE EXCEPTION 'Status rapor hanya bergerak maju, tidak dapat kembali dari % ke %',
            OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rapor_status_maju
    BEFORE UPDATE OF status ON rapor
    FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
    EXECUTE FUNCTION cegah_status_mundur();
