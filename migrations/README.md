# Migrasi

Aturan lengkap pada [DEPLOYMENT.md](../../context/DEPLOYMENT.md) sec 6.3 dan sec 6.5, dan
ringkasannya pada [AGENTS.md](../AGENTS.md) sec 5.3.

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

## Sebelum menulis migrasi `contract` — lapis 3

Buktikan tidak ada yang memakainya. Jangan diperkirakan:

```bash
grep -rn "<nama_kolom>" ../src/
```

## Sebelum commit — lapis 2

```bash
npm run lint:migrations
```
