# Migrasi

Aturan lengkap pada [DEPLOYMENT.md](../../context/DEPLOYMENT.md) sec 6.3 dan sec 6.5, dan
ringkasannya pada [AGENTS.md](../AGENTS.md) sec 5.3.

Urutan kesepuluh berkas dan isinya ditetapkan [SCHEMA.md](../../context/SCHEMA.md) sec 9.1.
Yang membentuk basis data adalah berkas di sini; skema Drizzle pada `src/db/skema/`
adalah bentuk bertipe atas hasilnya, dipakai lapisan kueri. Keduanya dijaga tetap
selaras oleh `tests/db/selaras-drizzle.test.ts`.

## Penamaan — lapis 1

```
0011_expand_tambah_deskripsi.sql     menambah, selalu aman
0013_contract_hapus_kkm.sql          menghapus, hanya boleh menyusul
```

Berkas `contract` tanpa `expand` pendahulunya adalah tanda bahaya.

## Header wajib — lapis 0

Setiap berkas dibuka dengan blok ini. Yang dipaksa bukan formatnya, melainkan
keputusannya ditulis alih-alih disimpulkan.

```sql
-- migrasi : 0011
-- jenis   : additive | backward-compatible | breaking | dual-schema
-- mundur  : ya | tidak — beserta alasannya
-- dibaca  : api, migrate, app_ro
-- penutup : nomor migrasi contract yang kelak menutupnya, atau —
```

Ditegakkan `tests/unit/migrasi-header.test.ts`, sehingga berkas tanpa header yang
sah gagal pada `npm run periksa` — bukan ditemukan saat tinjauan.

## Batas kunci dan batas pernyataan

Setiap berkas menyusulkan dua baris ini sesudah headernya:

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
```

Rilis menunggu migrasi selesai ([DEPLOYMENT.md](../../context/DEPLOYMENT.md) sec 3.3
langkah 6), sehingga migrasi yang menggantung menahan seluruh rilis sambil memegang
kunci. Lebih baik gagal cepat dan diulang. Migrasi yang memang memerlukan waktu
lebih — misalnya pengisian data — menaikkan batasnya sendiri beserta alasannya.

## Sebelum menulis migrasi `contract` — lapis 3

Buktikan tidak ada yang memakainya. Jangan diperkirakan:

```bash
grep -rn "<nama_kolom>" ../src/
```

## Sebelum commit — lapis 2

```bash
npm run lint:migrations
```

Konfigurasinya pada [`.squawk.toml`](../.squawk.toml). Tiga aturan dimatikan di sana
beserta alasannya, dan seluruhnya menunjuk keputusan yang sudah terkunci. Aturan
yang menjaga `DROP COLUMN`, `DROP TABLE`, `RENAME COLUMN`, dan `NOT NULL` tanpa
`DEFAULT` **tidak boleh dimatikan** tanpa amandemen DEPLOYMENT.md.

## Menjalankan dan membuktikannya

```bash
docker compose up -d db     # PostgreSQL 17 lokal
npm run test:db             # menerapkan kesepuluh migrasi lalu membuktikan penolakannya
```

`npm run test:db` menyalakan PostgreSQL-nya sendiri lewat Testcontainers, sehingga
tidak bergantung pada compose yang sedang menyala.
