# Panduan Agen — EduTrack

| Keterangan | Isi |
|---|---|
| **Versi** | v2.3 |
| **Tanggal** | 10 Agustus 2026 |
| **Disusun oleh** | Re:Code |
| **Kedudukan** | Menetapkan **bagaimana agen membangun EduTrack** di atas dokumen yang sudah terkunci. Berada di luar rantai penguncian dan tidak menetapkan apa pun tentang produk |
| **Kerangka kerja** | [ECC](https://github.com/affaan-m/ecc) — aturan, agen, dan perintah yang terpasang pada `~/.claude/` |

> Dokumen ini **tidak memiliki lampiran Catatan Keputusan**. Ia bukan keputusan produk maupun keputusan teknis, melainkan cara kerja; seluruh isinya disunting langsung ketika berubah.
>
> Apabila isi dokumen ini bertentangan dengan dokumen pada rantai penguncian, **dokumen pada rantai penguncian yang berlaku**.

---

## 1. Hukum pertama

**Dokumen mendahului kode. Kode mengikuti dokumen, tidak pernah sebaliknya.**

Delapan dokumen sudah terkunci berurutan, dan setiap keputusan di dalamnya sudah dibayar dengan pertimbangan yang tercatat. Kode yang menyimpang tanpa mengubah dokumennya menghasilkan sistem yang tidak seorang pun dapat menjelaskan alasannya enam bulan kemudian.

```
PRD  →  RFC-001  →  Techstack  →  ARCHITECTURE  →  SCHEMA  →  API  →  kode
```

Agen yang menemukan alasan kuat untuk menyimpang **berhenti dan mengubah dokumennya lebih dahulu** (§1.2). Menyimpang diam-diam adalah pelanggaran terberat pada panduan ini.

### 1.1 Peta baca

Membaca seluruh delapan dokumen sebelum setiap tugas adalah pemborosan. Membaca terlalu sedikit menghasilkan kode yang melanggar invarian. Tabel ini menetapkan batas minimumnya.

| Yang dikerjakan | Wajib dibaca sebelum menulis kode |
|---|---|
| Apa pun, bila menemui singkatan asing | [GLOSARIUM.md](GLOSARIUM.md) |
| Skema Drizzle dan migrasi | [SCHEMA.md](SCHEMA.md) §4–§7 dan §9 · [RFC-001](RFC-001-model-data-konseptual.md) §6 |
| Endpoint apa pun | [API.md](API.md) §2, §10, dan pasal endpoint terkait · [ARCHITECTURE.md](ARCHITECTURE.md) §9.2 |
| Autentikasi dan sesi | [ARCHITECTURE.md](ARCHITECTURE.md) §9 · [Techstack.md](Techstack.md) §5 · [API.md](API.md) §3 |
| Nilai | [RFC-001](RFC-001-model-data-konseptual.md) §5.1 · [ARCHITECTURE.md](ARCHITECTURE.md) §14.1 · [API.md](API.md) §6 |
| Presensi | [PRD.md](PRD.md) §8.4 · invarian I-14 sampai I-18 · [API.md](API.md) §7 |
| Rapor dan berkasnya | [PRD.md](PRD.md) §9 · [RFC-001](RFC-001-model-data-konseptual.md) §5.5 · [ARCHITECTURE.md](ARCHITECTURE.md) Pasal 11 · [API.md](API.md) §8 |
| Jalur AI | [PRD.md](PRD.md) §8.5 dan §8.6 · [ARCHITECTURE.md](ARCHITECTURE.md) Pasal 10 · [SCHEMA.md](SCHEMA.md) §7.1 · [API.md](API.md) §9.1 |
| Unggah berkas | [PRD.md](PRD.md) §6.1.1, §6.1.2, §6.1.5 · AC-26 · [API.md](API.md) §5.2 dan §5.7 |
| Pemeriksaan kewenangan | [aktor-role.md](aktor-role.md) seluruhnya · [ARCHITECTURE.md](ARCHITECTURE.md) §9.2 |
| Frontend | [ATURAN-DAN-KRITERIA.md](ATURAN-DAN-KRITERIA.md) §3 · [ARCHITECTURE.md](ARCHITECTURE.md) Pasal 4 · aturan ECC `web/` |
| Terraform dan CI/CD | [Techstack.md](Techstack.md) · [ARCHITECTURE.md](ARCHITECTURE.md) Pasal 2 dan 12 · [DEPLOYMENT.md](DEPLOYMENT.md) |

### 1.2 Ketika kode dan dokumen bertentangan

Ini akan terjadi, dan bukan pertanda ada yang salah. Prosedurnya tetap:

1. **Berhenti.** Jangan menulis kode yang menyimpang sambil berniat merapikan dokumen belakangan.
2. **Tentukan dokumen yang berwenang** menurut rantai penguncian. Yang lebih hulu selalu menang.
3. **Isi deskriptif** — sunting langsung, ganti bagian yang usang.
4. **Isi keputusan** — tulis Catatan Keputusan **baru** yang menyebut nomor yang diamandemen. Entri lama tidak pernah disunting.
5. **Menyentuh PRD** — ajukan sebagai **temuan**, jangan ubah sepihak. PRD adalah kesepakatan dengan sekolah, bukan milik tim teknis.
6. **Commit dokumennya lebih dahulu, kodenya menyusul.** Dua commit terpisah, dokumen di depan.

Contoh yang sudah terjadi dan boleh ditiru bentuknya: `CK-13` menggugurkan tiga dari empat alasan `CK-01`; `CK-A-07` mengamandemen `CK-09` dari dokumen yang kini memuat isinya.

---

## 2. Alur kerja per tugas

Mengikuti **Feature Implementation Workflow** ECC, disesuaikan dengan keadaan EduTrack.

### Fase 0 — Riset dan pemakaian ulang

Wajib sebelum menulis apa pun yang baru. Urutannya mengikat:

1. **Pencarian kode GitHub** — `gh search repos`, `gh search code` untuk pola yang sudah terbukti.
2. **Dokumentasi pustaka** — Context7 atau dokumen resmi vendor untuk perilaku API dan detail versi.
3. **Registri paket** — npm sebelum menulis utilitas sendiri.
4. **Pencarian web** hanya apabila ketiganya belum cukup.

Untuk EduTrack yang paling sering relevan: Drizzle (partial index, composite foreign key, pemicu), Lambda Web Adapter, `express-rate-limit` dengan penyimpan PostgreSQL, Argon2id di Node, pdfmake, dan Zod.

### Fase 1 — Rencana

Gunakan agen **planner** atau perintah `/plan`. Untuk tugas berlapis, **code-architect** memetakan berkas, antarmuka, dan urutan pembangunan lebih dahulu.

Rencana wajib menyebut: berkas yang disentuh, invarian yang terlibat, kriteria kesiapan (`AC-xx`) yang menjadi sasaran, dan apa yang **tidak** dikerjakan.

Tunggu persetujuan sebelum menulis kode. Rencana yang tidak dibaca siapa pun bukan rencana.

### Fase 2 — TDD

Gunakan agen **tdd-guide** atau perintah `/react-test`. Urutannya mengikat: **RED → GREEN → REFACTOR**.

Untuk EduTrack, tes pertama yang ditulis bukan tes fungsi melainkan **tes invarian**. Sebelum menulis `simpanNilai()`, tulis tes yang membuktikan nilai kedua pada komponen dan siswa yang sama ditolak (I-13). Invarian adalah pernyataan yang harus benar sepanjang umur sistem; ia layak diuji lebih dahulu daripada jalur bahagia.

### Fase 3 — Tinjauan

Dijalankan **paralel**, bukan berurutan. Agen yang dipakai bergantung pada apa yang disentuh:

| Yang disentuh | Agen |
|---|---|
| Selalu | **code-reviewer** |
| `.ts` | **typescript-reviewer** |
| `.tsx`, komponen React | **react-reviewer** |
| Migrasi, kueri, indeks | **database-reviewer** |
| Autentikasi, unggah, jalur AI, presigned URL, rahasia | **security-reviewer** — wajib, tanpa pengecualian |
| Penanganan galat | **silent-failure-hunter** |

Selesaikan seluruh temuan **CRITICAL** dan **HIGH** sebelum commit. **MEDIUM** diselesaikan bila memungkinkan.

### Fase 4 — Verifikasi

**Bukti, bukan klaim.** Jangan pernah menyatakan sesuatu selesai, lulus, atau diperbaiki tanpa menjalankan perintahnya dan membaca keluarannya. Kalau tes gagal, katakan gagal beserta keluarannya. Kalau satu langkah dilewati, katakan dilewati.

Sebelum commit, ketiga perintah berikut wajib bersih. Ketiganya terpisah karena yang kedua dan ketiga menuntut hal yang tidak selalu ada di mesin mana pun:

```bash
npm run periksa          # format, lint, tsc --noEmit, tes, dan cakupan
npm run lint:migrations  # lapis 2 §5.3 — menuntut squawk terpasang
npm run test:db          # bukti penegakan basis data §4.2 — menuntut Docker
```

`npm run periksa` menjalankan `coverage`, bukan `test`, sehingga ambang cakupan §4.1 ikut menggerbang. Menjalankan `npm test` saja melewati ambangnya tanpa terlihat.

### Fase 5 — Commit dan push

Format conventional commit sesuai aturan ECC:

```
<type>: <deskripsi>

<badan opsional>
```

Jenis: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

Pesan commit ditulis dalam **Bahasa Indonesia**, mengikuti konvensi repositori dokumen. Sebutkan invarian atau `AC-xx` yang terkait bila ada.

---

## 3. Batas yang tidak boleh dilanggar

### 3.1 Batas modul

Ditetapkan [ARCHITECTURE.md §5.1](ARCHITECTURE.md). Pelanggarannya tidak selalu terlihat sebagai kesalahan, sehingga wajib diperiksa saat tinjauan.

| Lapisan | Boleh mengimpor | Dilarang mengimpor |
|---|---|---|
| `domain/` | tidak ada | `db`, `adapters`, SDK AWS, `express` |
| `routes/` | `domain`, `db`, `ports` | `adapters/aws` secara langsung |
| `adapters/*` | `ports`, SDK yang bersangkutan | `domain`, `routes` |
| `entry/` | `app`, `adapters` | — |

`domain/` tanpa I/O berarti seluruh logika penilaian dapat diuji tanpa basis data dan tanpa AWS. Untuk bagian yang salah hitungnya berarti rapor siswa salah, ini bukan kemewahan.

### 3.2 Larangan mutlak

Dua belas hal berikut tidak boleh dilakukan agen dalam keadaan apa pun tanpa amandemen dokumen lebih dahulu.

| # | Larangan | Dasar |
|:--:|---|---|
| 1 | Menulis apa pun dari jalur AI, atau memakai koneksi selain `app_ro` di sana | I-23, AC-20 |
| 2 | Mengirim nama, NIS, atau pengenal siswa ke layanan AI | Techstack §6, ARCHITECTURE §10.1 |
| 3 | Menyimpan keluaran AI ke tabel, cache, maupun log | I-24, NG14, AC-16 |
| 4 | Menambah antrean, worker, cron, atau pekerjaan latar | CK-07 |
| 5 | Menambah penyimpanan otomatis tanpa tombol simpan | P22, AC-15 |
| 6 | Mengimpor SDK AWS di luar `adapters/aws/` | Prinsip ③ Techstack §1 |
| 7 | Melakukan I/O di dalam `domain/` | ARCHITECTURE §5.1 |
| 8 | Membangun entitas atau atribut yang digugurkan | RFC-001 §7 |
| 9 | Membuat endpoint yang sengaja ditiadakan | API §11 |
| 10 | Menurunkan status rapor, atau membuat jalur buka kembali | I-21, PRD §9 |
| 11 | Menaruh rahasia di dalam kode, log, atau repositori | Techstack §7 |
| 12 | Menerima data luar tanpa melewati Zod di batas HTTP | ARCHITECTURE Pasal 12 |

### 3.3 Invarian

Dua puluh lima invarian tercatat pada [RFC-001 §6](RFC-001-model-data-konseptual.md), dan cara penegakan masing-masing pada [SCHEMA.md §5.1](SCHEMA.md). Tujuh belas ditegakkan basis data; agen tidak perlu menulis kode untuk itu, tetapi **wajib tidak melemahkannya**.

Lima invarian berikut **sepenuhnya bergantung pada kode**. Di sinilah kekeliruan menghasilkan data atau tampilan salah tanpa ditolak siapa pun:

| Invarian | Isi | Letak |
|---|---|---|
| I-17 | Izin dan Sakit terhitung sebagai kehadiran | `domain/presensi.ts` |
| I-18 | Penyebut kehadiran adalah jumlah sesi yang dibuka | kueri agregat |
| I-20 | Finalisasi hanya bila seluruh mata pelajaran lengkap | transaksi finalisasi |
| I-22 | Rapor final terkunci bagi Guru dan Wali Kelas | lapisan rute |
| I-25 | Siswa hanya membaca datanya sendiri | lapis baris |

Kelimanya adalah **sasaran utama uji integrasi**, bukan sasaran sampingan.

---

## 4. Pengujian

### 4.1 Sasaran cakupan

| Bagian | Sasaran | Ditegakkan sejak | Alasan |
|---|--:|---|---|
| `domain/` | **100%** pada keempat metrik | A3 | Salah hitung berarti rapor siswa salah, dan tidak ada yang menangkapnya |
| Global | **80%** | **A5** | Aturan ECC |
| Lima invarian §3.3 | seluruhnya | A3 dan seterusnya | Tidak ada penjaga lain |

`domain/` dipatok pada keempat metrik, bukan cabangnya saja: fungsi domain yang tidak pernah dipanggil sama sekali juga tidak terbukti benar.

**Ambang global menunggu A5, dan itu disengaja.** Cakupan diukur dua suite terpisah — `npm test` dan `npm run test:db` — karena yang kedua menuntut Docker sehingga tidak dapat digabung ke dalam satu perintah yang selalu dapat berjalan. Sebelum lapisan rute ada, angkanya hanya dapat dicapai dengan mengecualikan separuh `src/`, dan ambang yang dicapai lewat pengecualian tidak menjaga apa pun.

**Ambang cakupan wajib dibuktikan dapat merah.** Glob yang salah tulis tidak menghasilkan peringatan apa pun; ia hanya diam dan lolos. Setiap kali ambang dipasang atau diubah, pindahkan sementara ke bagian yang cakupannya rendah, pastikan `npm run coverage` gagal, lalu kembalikan.

### 4.2 Pembuktian penegakan basis data

Selain uji unit dan integrasi, EduTrack memiliki tingkat ketiga yang tidak lazim: **uji yang membuktikan basis data menolak**. Bentuknya adalah pernyataan SQL yang **wajib gagal**.

```sql
-- app_ro tidak dapat menulis (I-23, AC-20)
UPDATE nilai SET nilai = 100 WHERE id = '<pengenal mana pun>';
-- ERROR: permission denied for table nilai

-- app_ro tidak dapat membaca identitas (SCHEMA §7.1)
SELECT nama FROM pengguna LIMIT 1;
-- ERROR: permission denied for table pengguna

-- jenjang tidak cocok mustahil tersimpan (I-06, AC-24)
INSERT INTO penugasan (guru_ref, mapel_ref, kelas_ref, tingkat) VALUES (…);
-- ERROR: violates foreign key constraint

-- status rapor tidak dapat mundur (I-21)
UPDATE rapor SET status = 'draft' WHERE status = 'finalized';
-- ERROR: Status rapor hanya bergerak maju
```

Perbedaannya menentukan. Membaca kode membuktikan **jalur yang ada hari ini** tidak melanggar; penolakan basis data membuktikan **jalur mana pun tidak akan bisa**.

Dijalankan lewat perintahnya sendiri, terpisah dari `npm run periksa`:

```bash
npm run test:db
```

Suite ini menyalakan PostgreSQL 17 sungguhan lewat Testcontainers, menerapkan seluruh migrasi, lalu menjalankan pernyataan yang wajib gagal. Ia **tidak boleh diganti tiruan**: tiruan tidak dapat membuktikan apa pun tentang penolakan PostgreSQL.

Karena satu kontainer dipakai bersama, tesnya berjalan berurutan dan setiap tes membungkus dirinya dalam transaksi yang selalu dibatalkan — sehingga kegagalan berarti pelanggaran invarian, bukan perlombaan antar tes. Benihnya menyediakan entitas cadangan yang belum terpakai, supaya penolakan yang diuji benar-benar penolakan yang dimaksud dan bukan constraint lain yang kebetulan menyala lebih dahulu.

### 4.3 Frontend

Mengikuti aturan ECC `web/testing.md`, dengan prioritas: regresi visual, aksesibilitas, kinerja, lintas peramban, responsif.

Titik uji lebar layar: **320, 375, 768, 1024, 1440**. Wajib terbaca pada perangkat bergerak (NG5), dan **bukan** aplikasi Android maupun iOS.

Sasaran Core Web Vitals dan anggaran bundel mengikuti ECC `web/performance.md`: LCP < 2,5 s, INP < 200 ms, CLS < 0,1, dan JS terkompresi < 300 kb untuk halaman aplikasi.

Layar yang paling perlu regresi visual adalah **matriks nilai 30 × 8** ([ARCHITECTURE.md](ARCHITECTURE.md) Pasal 4). Layar itu paling padat, paling sering dipakai Guru, dan paling mudah rusak pada layar sempit.

---

## 5. Konvensi kode

### 5.1 Bahasa dan penamaan

Kosakata domain **tetap Bahasa Indonesia di seluruh lapisan**. Jangan menerjemahkan `nilai`, `penugasan`, `rapor`, `presensi`, `mapel`, atau `kelas` menjadi padanan Inggris — penerjemahan sebagian adalah cara tercepat menghasilkan dua kosakata yang tidak dapat ditelusuri satu sama lain.

Yang berubah antar lapisan hanya **penulisan huruf**, mengikuti kelaziman masing-masing:

| Lapisan | Bentuk | Contoh |
|---|---|---|
| Tabel dan kolom | `snake_case` | `kelas_siswa.siswa_ref` |
| Alamat dan bidang JSON | `snake_case` | `/api/penugasan/:id/nilai`, `siswa_ref` |
| Pengenal TypeScript | `camelCase` | `siswaRef`, `hitungNilaiAkhir()` |
| Tipe dan komponen | `PascalCase` | `type Penugasan`, `MatriksNilai` |
| Konstanta | `UPPER_SNAKE_CASE` | `BATAS_UNGGAH_BYTE` |
| Pesan bagi pengguna | Bahasa Indonesia | API §2.2 |
| Log server | Bahasa Inggris ringkas, **tanpa data pribadi** | — |

### 5.2 Gaya

Mengikuti ECC `common/coding-style.md` dan `web/coding-style.md`. Yang paling sering dilanggar:

- **Kekekalan.** Bentuk objek baru, jangan mengubah yang ada.
- **Berkas kecil.** 200–400 baris lazim, 800 maksimum. Susun menurut fitur, bukan menurut jenis berkas.
- **Fungsi pendek.** Di bawah 50 baris, kedalaman bersarang di bawah 4.
- **Galat ditangani terang-terangan.** Tidak ada galat yang ditelan diam-diam.
- **Tanpa angka ajaib.** Angka seperti 2 MB, 20 detik, 5 menit, dan 12 jam sudah ditetapkan dokumen; jadikan konstanta bernama yang menyebut sumbernya.

### 5.3 Migrasi

**Migrasi wajib kompatibel mundur**, karena rollback aplikasi memindahkan alias tanpa memindahkan skema — kode rilis sebelumnya harus tetap berjalan di atas skema baru. Aturan lengkapnya pada [DEPLOYMENT.md §6.3](DEPLOYMENT.md).

Lima aturan yang mengikat:

| # | Aturan |
|:--:|---|
| 1 | Kode versi sebelumnya wajib tetap berjalan di atas skema baru |
| 2 | Penghapusan kolom dipisahkan ke rilis berikutnya |
| 3 | `NOT NULL` baru wajib bernilai bawaan, atau dipecah tiga rilis |
| 4 | Penggantian nama kolom dilarang — tambah, salin, hapus |
| 5 | Satu berkas migrasi, satu transaksi |

**Setiap berkas migrasi dibuka dengan header klasifikasi.** Yang dipaksa bukan formatnya, melainkan keputusannya ditulis alih-alih disimpulkan:

```sql
-- migrasi : 0011
-- jenis   : additive | backward-compatible | breaking | dual-schema
-- mundur  : ya | tidak — beserta alasannya
-- dibaca  : api, migrate, app_ro
-- penutup : nomor migrasi contract yang kelak menutupnya, atau —
```

Penamaan berkas menyatakan fasenya: `0011_expand_*.sql`, `0013_contract_*.sql`.

**Sebelum menulis migrasi `contract`**, buktikan tidak ada yang memakainya — jangan diperkirakan:

```bash
grep -rn "<nama_kolom>" src/
```

**Setiap berkas menyusulkan dua baris batas** sesudah headernya. Rilis menunggu migrasi selesai ([DEPLOYMENT.md §3.3](DEPLOYMENT.md) langkah 6), sehingga migrasi yang menggantung menahan seluruh rilis sambil memegang kunci:

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
```

Migrasi yang memang memerlukan waktu lebih — misalnya pengisian data — menaikkan batasnya sendiri beserta alasannya.

**Migrasi wajib lolos linter** sebelum di-commit:

```bash
npm run lint:migrations
```

Konfigurasinya pada `.squawk.toml`, dan **namanya wajib berawalan titik** — `squawk.toml` diabaikan diam-diam tanpa peringatan apa pun, sehingga aturan yang dikecualikan tampak tidak berpengaruh. Di dalamnya `assume_in_transaction` dinyalakan karena penerap memang membungkus setiap berkas `BEGIN..COMMIT`. Setiap aturan yang dikecualikan wajib menyebut keputusan terkunci yang menjadi dasarnya; aturan yang menjaga `DROP COLUMN`, `DROP TABLE`, `RENAME COLUMN`, dan `NOT NULL` tanpa `DEFAULT` **tidak boleh dimatikan** tanpa amandemen DEPLOYMENT.md.

**Migrasi yang sudah pernah diterapkan tidak boleh disunting.** Penerap mencatat sidik jari SHA-256 setiap berkas dan menolak melanjutkan apabila isinya berubah. Perbaikan ditulis sebagai migrasi baru, bukan sebagai suntingan atas yang lama.

Enam lapis penjagaan beserta alasannya pada [DEPLOYMENT.md §6.5](DEPLOYMENT.md) dan CK-D-03. Lapis 4 dan 5 — tes rilis sebelumnya terhadap skema baru, dan latihan rollback sungguhan — wajib ada **sebelum data sekolah sungguhan dimuat**.

---

## 6. Agen, perintah, dan delivery

Terpasang pada `~/.claude/`. Gunakan yang sudah ada; jangan menulis ulang kemampuan yang tersedia.

| Kebutuhan | Agen | Perintah |
|---|---|---|
| Rencana fitur berlapis | `planner`, `code-architect` | `/plan`, `/feature-dev` |
| Keputusan arsitektural | `architect` | — |
| Menelusuri kode yang ada | `code-explorer` | — |
| TDD | `tdd-guide` | `/react-test` |
| Tinjauan umum | `code-reviewer` | `/code-review` |
| Tinjauan TypeScript dan React | `typescript-reviewer`, `react-reviewer` | `/react-review` |
| Tinjauan basis data | `database-reviewer` | — |
| Tinjauan keamanan | `security-reviewer` | `/security-scan` |
| Build gagal | `build-error-resolver`, `react-build-resolver` | `/build-fix`, `/react-build` |
| Cakupan tes | — | `/test-coverage` |
| Uji alur pengguna | `e2e-runner` | — |
| Membersihkan kode mati | `refactor-cleaner`, `code-simplifier` | `/refactor-clean`, `/simplify` |
| Menyelaraskan dokumen | `doc-updater` | `/update-docs` |
| Menandai titik aman | — | `/checkpoint` |

**Delivery adalah unit kendali.** Nama agen, model, harness, dan perintah hanyalah cara mencapai hasil. Pekerjaan dinilai dari artefak dan bukti yang dikirim: perubahan terarah, tes RED yang sah, implementasi GREEN, review sesuai risiko, gerbang selesai, commit yang dapat dikembalikan, dan laporan akhir yang dapat diverifikasi. Tidak ada delivery yang dianggap lebih baik hanya karena memakai model lebih mahal atau lebih banyak agen.

**Satu pemilik membawa satu irisan sampai selesai.** Secara bawaan, agen utama memegang satu siklus utuh — memahami kontrak, menulis RED, membuat GREEN, merapikan, menjalankan focused test, dan menyiapkan commit. Jangan memisahkan tes dan implementasi fitur yang sama kepada dua agen apabila keduanya harus saling menunggu atau membaca konteks yang sama.

**Delegasi mengikuti risiko dan kebebasan kerja, bukan ketersediaan agen.** Panggil subagen hanya ketika pekerjaan berbatas jelas, dapat berjalan tanpa berebut berkas atau artefak tes, dan hasilnya dapat diperiksa dengan kriteria selesai yang pendek. Biaya menjelaskan pekerjaan tidak boleh lebih besar daripada mengerjakannya langsung. Context packet subagen cukup memuat tujuan, berkas/rentang commit, kontrak terkait, fokus risiko, serta bentuk keluaran; jangan meneruskan seluruh riwayat sesi tanpa kebutuhan.

**Jumlah minimum yang cukup.** Untuk perubahan biasa, satu review gabungan setelah GREEN cukup. Untuk perubahan berisiko tinggi, tambahkan review independen hanya pada dimensi yang benar-benar terlibat — misalnya keamanan untuk autentikasi/rahasia/data siswa dan basis data-concurrency untuk transaksi/race. Default satu gelombang tidak lebih dari dua reviewer; penambahan reviewer wajib didasari risiko atau temuan nyata, bukan daftar peran yang tersedia.

**Paralelisme bersyarat.** Jalankan pekerjaan paralel hanya bila tidak menyunting berkas yang sama, tidak membersihkan atau menulis direktori coverage yang sama, tidak memakai fixture basis data yang saling mengganggu, dan tidak menunggu keputusan satu sama lain. Jika salah satu syarat gagal, kerjakan berurutan. Kecepatan dinding tidak boleh dibayar dengan konflik, pengulangan tes, atau bukti yang tidak dapat dipercaya.

**Keluaran subagen ringkas dan dapat ditindaklanjuti.** Review hanya melaporkan temuan `CRITICAL`, `HIGH`, atau `MEDIUM` beserta `file:baris`, dampak, dan perbaikan yang dapat diuji; apabila bersih, jawab `CLEAN`. Jangan mengulang ringkasan kode yang sudah terlihat. Re-review dibatasi pada temuan dan berkas yang berubah, kecuali perubahan tersebut menggeser arsitektur atau batas keamanan.

**Testing bertingkat.** Selama pembangunan gunakan tes RED tunggal, focused suite, lint, dan typecheck. Full gate dijalankan ketika satu milestone terintegrasi selesai dan sekali lagi pada keadaan final sebelum push — bukan setelah setiap suntingan kecil. Kegagalan menyimpan log lengkap; keberhasilan cukup mencatat perintah, exit code, jumlah tes, dan metrik yang menjadi bukti.

**Ketika kemampuan review tidak tersedia.** Tanggung jawab delivery tidak hilang hanya karena nama agen tertentu tidak ada. Tinjauan umum boleh memakai kemampuan setara pada harness yang tersedia. Untuk autentikasi, unggah, jalur AI, presigned URL, rahasia, transaksi akademik, atau isolasi data siswa, review independen sesuai risikonya tetap wajib; apabila tidak dapat diperoleh, agen berhenti dan melaporkan bukti yang belum tersedia sebelum commit.

**Pemilihan model tidak diatur dokumen ini.** Gunakan kemampuan yang tersedia dan proporsional terhadap risiko, tetapi jangan mengubah workflow, memperbanyak delegasi, atau menurunkan bukti delivery hanya karena nama model tertentu tersedia atau tidak tersedia. Model boleh berganti; kontrak, tes, review, dan gerbang selesai tidak.

---

## 7. Kait yang disarankan

Urutan mengikat: **format → lint → periksa tipe → build**.

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write|Edit", "command": "npm exec prettier -- --write \"$FILE_PATH\"" },
      { "matcher": "Write|Edit", "command": "npm exec eslint -- --fix \"$FILE_PATH\"" },
      { "matcher": "Write|Edit",
        "command": "timeout 60 npm exec tsc -- --noEmit --pretty false --incremental --tsBuildInfoFile node_modules/.cache/tsc-hook.tsbuildinfo" }
    ]
  }
}
```

`--incremental` dan `timeout` keduanya wajib. Tanpa `--incremental`, setiap suntingan memeriksa ulang seluruh program; pada laju suntingan agen, proses `tsc` menumpuk. Tanpa `timeout`, `tsc` yang menggantung tidak pernah keluar. `--tsBuildInfoFile` diperlukan karena `--noEmit` menekan penulisan buildinfo.

---

## 8. Tahap implementasi

Dua jalur **dapat** berjalan bersamaan. Pembagiannya bukan soal keahlian melainkan soal apa yang mungkin: setiap jalur menuju kuasa AWS menuntut kode MFA dari ponsel manusia, sehingga **agen tidak dapat menaikkan infrastruktur sama sekali**.

> **Urutan yang berlaku sejak 11 Agustus 2026: lokal lebih dahulu.** Jalur A diselesaikan sampai seluruh fiturnya berjalan di `docker compose` setempat, dan Jalur B **ditahan setelah B1** sampai saat itu. Alasannya dua. Pertama, RDS mulai menagih sejak menit ia menyala, sedangkan tidak satu pun tahap Jalur A membutuhkannya. Kedua — dan ini yang menentukan — janji "satu image, dua lingkungan" pada Pasal 13 [ARCHITECTURE.md](../context/ARCHITECTURE.md) belum pernah dibuktikan: `ports/Secrets` belum ada, `adapters/aws/` belum ada, dan `entry/server.ts` masih memilih adapter lokal secara tetap. Menaikkan infrastruktur sebelum sambungannya ada berarti membayar sewa untuk sesuatu yang belum dapat dihubungi.

```
JALUR A — aplikasi (agen)            JALUR B — infrastruktur (manusia)

A0  kerangka repositori              B0    IAM: user, grup, role
A1  Docker dan compose               B0.5  OIDC + uji jabat tangan
      │                                      │
      └─────────────┬───────────────  B1    terraform bootstrap/
A2  skema + migrasi │                 B2    push image healthz  ◄── butuh A1
A3  domain/ murni   │                 B3    terraform infra/
A4  auth + sesi     │                 B4    buktikan OAC ber-body
A5  administrasi    │                 B5    izin ECR + Lambda pada role OIDC
A6  nilai + presensi│                 B6    pr.yml dan deploy.yml
A7  rapor + berkas  └────────────────────────►│
A8  jalur AI                                  ▼
                                         rilis otomatis
```

**Hanya dua titik temu.** B2 menunggu `Dockerfile` dari A1; rilis pertama menunggu B6. Selebihnya kedua jalur tidak saling menunggu.

**Satu gerbang A7 memang tidak dapat ditutup secara lokal.** Pengukuran lama render tiga puluh PDF pada [API.md §13.3](../context/API.md) menuntut fungsi Lambda 1024 MB arm64 yang sungguhan. Selama Jalur B ditahan, A7 tetap tercatat **sebagian**; angkanya diambil pada rilis pertama. Yang diukur lokal hanya pembandingnya.

### 8.1 Jalur A — dikerjakan agen, tanpa menyentuh AWS

**Jalur A seluruhnya backend.** Frontend tidak memiliki tahap di sini dan **berada di luar cakupan agen ini** — layarnya ditetapkan [ATURAN-DAN-KRITERIA §3](../context/ATURAN-DAN-KRITERIA.md) dan bentuknya [ARCHITECTURE Pasal 4](../context/ARCHITECTURE.md), tetapi pengerjaannya milik pihak lain. Aturan ECC `web/` dan §4.3 dokumen ini tetap berlaku apabila kelak dikerjakan di repositori yang sama. "Seluruh fitur berjalan lokal" karenanya berarti **seluruh endpoint terbukti lewat suite tes**, bukan lewat layar.


| # | Tahap | Isi | Gerbang selesai |
|:--:|---|---|---|
| **A0** | Kerangka repositori | `package.json`, `tsconfig` strict, eslint beserta **penegakan batas modul**, prettier, vitest, struktur `src/` sesuai [ARCHITECTURE §5.1](ARCHITECTURE.md), linter migrasi | `npm run periksa` bersih |
| **A1** | Docker | `Dockerfile` dengan Lambda Web Adapter, `docker-compose.yml` dengan PostgreSQL 17 | `docker compose up` menyala · `GET /healthz` menjawab |
| **A2** | Skema dan migrasi | Drizzle beserta migrasi 0001–0010 sesuai [SCHEMA §9.1](SCHEMA.md) | Seluruh migrasi jalan · **bukti penegakan basis data** §4.2 lulus · linter migrasi bersih |
| **A3** | `domain/` murni | `nilai.ts`, `presensi.ts`, `rapor.ts`. Tanpa I/O | **100% cabang** · I-17 dan I-18 terbukti |
| **A4** | Auth dan sesi | Argon2id, cookie, pembatas laju di PostgreSQL | AC-33 · pencabutan sesi seketika · batas 5 percobaan per 15 menit |
| **A5** | Administrasi | Akun, periode, mapel, kelas atomik | AC-01, 02, 03, 04, 22, 24, 26, 28 |
| **A6** | Nilai dan presensi | Simpan Nilai, sesi presensi | AC-05, 06, 11, 12, 15, 25, 29, 30 |
| **A7** | Rapor | Catatan, finalisasi, distribusi, berkas | AC-07, 08, 09, 13, 14, 32 · **pengukuran lama render** [API §13.3](API.md) |
| **A8** | Jalur AI | Tombol Suggestion lewat `app_ro` | AC-16, 17, 18, 19, 20, 21, 31 |

### 8.2 Jalur B — dikerjakan manusia

| # | Tahap | Kenapa agen tidak bisa |
|:--:|---|---|
| **B0** | IAM: user, grup, role | Konsol AWS, dan pembuatan MFA |
| **B0.5** | OIDC provider, role, uji jabat tangan | Konsol AWS. Lihat [RUNBOOK-OIDC.md](RUNBOOK-OIDC.md) |
| **B1** | `terraform apply` pada `bootstrap/` | Peminjaman role menuntut kode MFA |
| **B2** | Push image bootstrap ke ECR | Menunggu `Dockerfile` dari A1 |
| **B3** | `terraform apply` pada `infra/` | Sama seperti B1. Rahasia dibuat di luar Terraform |
| **B4** | Pembuktian penandatanganan OAC atas request ber-body | Menilai hasilnya menuntut penalaran manusia |
| **B5** | Menambahkan izin ECR dan Lambda pada role OIDC | Konsol AWS |
| **B6** | `pr.yml` dan `deploy.yml` | Berkasnya boleh ditulis agen; **penyalaannya** menunggu B5 |

### 8.3 Kenapa A2 dan A3 mendahului seluruh rute

`domain/` **tidak bergantung pada apa pun** — tanpa basis data, tanpa Docker, tanpa AWS — dan tesnya selesai dalam milidetik. Ia juga bagian dengan taruhan tertinggi: salah hitung berarti rapor siswa salah.

Setelah A3 lulus, seluruh perhitungan nilai, kehadiran, dan transisi rapor sudah benar dan terbukti, padahal belum ada satu pun endpoint. Sisanya tinggal mengantarkan data. Urutan yang dibalik membuat logika penilaian bocor ke dalam `routes/`, dan tidak akan pernah bisa diuji secepat itu lagi.

**Linter migrasi dipasang di A0, bukan di A2.** Linter yang datang setelah migrasi 0001 ditulis hanya memeriksa yang sudah terlanjur ada.

## 9. Gerbang selesai

Sebuah tugas selesai apabila seluruh baris berikut terpenuhi dan **terbukti**, bukan diperkirakan.

- [ ] Kriteria `AC-xx` yang menjadi sasaran lulus, dan nomornya disebut pada commit
- [ ] Invarian yang terlibat memiliki tesnya sendiri
- [ ] Cakupan memenuhi §4.1
- [ ] `tsc --noEmit` bersih, lint bersih, format rapi
- [ ] Temuan **CRITICAL** dan **HIGH** dari fase tinjauan selesai
- [ ] Tidak ada satu pun larangan §3.2 yang dilanggar
- [ ] Tidak ada rahasia, `console.log`, maupun sisa penelusuran
- [ ] Setiap mutasi menampilkan pemberitahuan berhasil atau gagal, dan kegagalannya menyebutkan alasan (P21, AC-27)
- [ ] Dokumen sudah diperbarui apabila ada yang menyimpang, dan **commit dokumennya mendahului commit kodenya**

---

## 10. Titik henti manusia

Agen **berhenti dan melapor** ketika mencapai salah satu titik berikut. Tidak mencari jalan pintas, tidak menebak nilainya, tidak melanjutkan dengan nilai sementara.

| Titik | Yang dibutuhkan | Kenapa agen tidak bisa |
|---|---|---|
| Kredensial AWS apa pun | Kode MFA | Berasal dari ponsel manusia |
| `terraform apply` | Peminjaman role `edutrack-terraform` | Sama |
| Pembuatan keempat rahasia | Dibuat di luar Terraform | [Techstack §7](Techstack.md) |
| Pendaftaran OIDC provider dan role | Konsol AWS | Lihat [RUNBOOK-OIDC.md](RUNBOOK-OIDC.md) |
| **Nama domain dan sertifikat** | Nama yang sesungguhnya, beserta pembelian domainnya | Bentuk DNS sudah ditetapkan **CK-17**; yang belum ada hanya namanya — [Techstack §9](Techstack.md) butir 4. **Dikerjakan paling akhir** |
| Komponen dan bobot templat | Validasi sekolah **V1** | Hanya data, bukan skema. **Tidak menghalangi** |

**Tiga pertanyaan sekolah sudah terjawab 8 Agustus 2026** dan tidak lagi menjadi titik henti: jenjang SMA saja (**S-04**), satu siswa satu kelas per semester (**T-02**), dan satu guru wali paling banyak satu kelas (**S-02**). Ketiganya sudah sesuai skema v1.0, sehingga tidak ada constraint yang berubah.

**Nama domain adalah satu-satunya titik henti yang sengaja ditunda paling akhir.** Ia tidak menghalangi satu pun tahap Jalur A: CK-17 sudah menetapkan bentuk DNS untuk AWS maupun on-prem, sehingga Terraform, `install.sh`, dan `docker-compose.yml` on-prem dapat ditulis dan ditinjau lengkap tanpa domain. Yang menunggu hanyalah pengisian nilainya dan penerapannya.

**Bentuk laporan berhenti:** sebutkan titik mana, apa yang dibutuhkan, apa yang sudah selesai, dan apa yang bisa dikerjakan sementara menunggu.

---

## 11. Git dan pemulihan

Riwayat git di sini bukan sekadar catatan — ia **satu rantai dengan pemulihan produksi**:

```
commit  →  git SHA  →  tag image  →  version Lambda  →  alias live
```

Rollback produksi berarti memindahkan alias ke version yang membeku pada satu SHA. Riwayat yang berantakan membuat pertanyaan "kembali ke mana" tidak punya jawaban.

| Aturan | Isi |
|---|---|
| **Satu fitur satu branch** | `fitur/<tahap>-<ringkas>`, misalnya `fitur/a3-domain-nilai` |
| **Satu commit satu satuan yang dapat dimundurkan sendiri** | Bukan satu commit per berkas, bukan satu commit per hari |
| **Commit hijau** | Jangan pernah commit keadaan yang tesnya merah. Riwayat harus dapat di-`checkout` di titik mana pun |
| **Dokumen mendahului kode** | Bila ada yang menyimpang, commit dokumennya lebih dahulu — dua commit terpisah (§1.2) |
| **Merge ke `main` lewat pull request** | `main` selalu dapat dirilis |
| **Tag pada tiap rilis** | `v<n>` pada commit yang dirilis, sehingga version Lambda dapat ditelusuri balik |
| **Jangan `push --force` ke `main`** | Menghapus jejak yang menjadi sandaran pemulihan |

**Yang berjalan di produksi saat ini** dijawab lewat perintah pada [DEPLOYMENT §2.7](DEPLOYMENT.md), bukan lewat tebakan — karena Terraform sengaja tidak mengetahuinya.

---

## 12. Memulai dari repositori kosong

Urutan konkret dari `backend/` yang hanya berisi `README.md` sampai lingkungan lokal menyala. Ini **A0 dan A1** pada §8.1.

| # | Langkah | Selesai apabila |
|:--:|---|---|
| 1 | `package.json`, `tsconfig.json` strict, `.gitignore`, `.env.example` | `npm install` berhasil |
| 2 | prettier, eslint beserta **penegakan batas modul** [ARCHITECTURE §5.1](ARCHITECTURE.md), vitest | `npm run periksa` bersih |
| 3 | Struktur `src/` — `app.ts`, `routes/`, `domain/`, `db/`, `ports/`, `adapters/`, `entry/` | Struktur cocok dengan ARCHITECTURE §5.1 |
| 4 | `GET /healthz` yang memeriksa proses **dan** koneksi basis data | Menjawab `200` |
| 5 | `Dockerfile` dengan Lambda Web Adapter | `docker build` berhasil |
| 6 | `docker-compose.yml` dengan PostgreSQL 17 | `docker compose up` menyala, `/healthz` menjawab dari dalam container |
| 7 | `migrations/` beserta konvensi header, `.squawk.toml`, dan langkah linter pada `pr.yml` | `npm run lint:migrations` **berjalan dan keluar dengan kode 0** |

**Batas modul ditegakkan eslint, bukan diingat.** Aturan impor pada §3.1 dipasang sebagai galat lint, sehingga `domain/` yang mengimpor `pg` gagal saat `npm run periksa` — bukan ditemukan saat tinjauan. Ini penerapan Prinsip ④ pada susunan berkas.

Sesudah langkah 7, agen melanjutkan ke A2 dan tidak lagi memerlukan apa pun dari manusia sampai menyentuh salah satu titik §10.

---

## 13. Alat bantu ingatan dan penelusuran

Dua alat terpasang pada mesin pengembang. Keduanya **membantu agen**, dan tidak satu pun menjadi sumber kebenaran — sumber kebenaran tetap dokumen pada `context/`.

### 13.1 engram — ingatan lintas sesi

Agen kehilangan seluruh konteks ketika sesi berakhir. `engram` menyimpannya dalam basis data SQLite di `~/.engram/engram.db`, dan menyediakannya kembali lewat MCP.

Repositori ini membawa konfigurasinya sendiri pada `.mcp.json`, sehingga agen mana pun yang bekerja di sini langsung memperolehnya:

```json
{ "mcpServers": { "engram": {
    "command": "engram",
    "args": ["mcp", "--tools=agent", "--project", "edutrack-backend"] } } }
```

**Nama proyek dipatok eksplisit.** Tanpa itu `engram` menyimpulkannya dari direktori, dan `engram doctor` sendiri memperingatkan bahwa penyimpulan tersebut menyebabkan ingatan tersimpan pada proyek yang salah. Profil `agent` dipilih karena memuat lima belas alat baca-tulis tanpa alat administratif seperti penghapusan proyek.

| Kapan | Yang dilakukan |
|---|---|
| **Awal sesi** | `mem_context` — membaca apa yang dikerjakan sesi sebelumnya |
| **Sebelum menggarap bagian yang asing** | `mem_search` — memeriksa apakah persoalannya pernah dihadapi |
| **Setelah pekerjaan bermakna selesai** | `mem_save` — satu tahap tuntas, satu bug terpecahkan, satu pendekatan gagal |

Bentuk simpanan mengikuti anjuran engram: **judul, jenis, lalu Apa / Kenapa / Di mana / Yang dipelajari.**

**Apabila MCP-nya tidak tersambung**, ketiga langkah di atas tetap dapat dijalankan lewat CLI dengan nama proyek disebut eksplisit. Jangan melewatinya hanya karena alatnya tidak muncul sebagai MCP:

```bash
engram context edutrack-backend
engram search "<kata kunci>" --project edutrack-backend
engram save "<judul>" "<isi>" --type <jenis> --project edutrack-backend
```

**Yang tidak boleh disimpan — ini yang paling menentukan.** Jangan menyalin isi dokumen ke dalam engram. Invarian, keputusan, kontrak endpoint, dan aturan migrasi sudah tercatat pada `context/`, dan menyalinnya menghasilkan **sumber kedua yang akan menyimpang**. Persoalan yang sama sudah dilawan di seluruh proyek ini.

Simpan yang **tidak** dicatat dokumen: kenapa sebuah pendekatan dicoba lalu ditinggalkan, jebakan yang baru ketahuan saat menjalankan, keadaan pekerjaan saat sesi berhenti di tengah.

Pemasangan tingkat mesin — beserta hook dan pemulihan setelah pemadatan konteks — bersifat opsional dan dijalankan sendiri:

```bash
engram setup claude-code
```

### 13.2 graphify — graf pengetahuan atas kode

`graphify` mengubah repositori ini menjadi graf yang dapat ditanyai, sehingga pertanyaan arsitektur dijawab dari graf alih-alih dengan membaca ulang berkas. Penghematan token datang dari situ.

**Grafnya sudah dibangun.** Keadaan pada 12 Agustus 2026, sesudah Jalur B:

| | |
|---|---|
| Simpul | 1.263 |
| Sisi | 2.582 — 99% hasil ekstraksi, 1% inferensi |
| Komunitas | 75, dan **hanya sekitar 16 yang berlabel bermakna** |
| Korpus | 196 berkas, ~122.000 kata |
| Dibangun dari | commit `f5689ea4` |
| Keluaran | `graphify-out/graph.html`, `GRAPH_REPORT.md`, `graph.json` |

#### Kewajiban

**Tanya graf lebih dahulu, baca berkas belakangan.** Untuk pertanyaan yang bentuknya "apa yang memanggil X", "bagaimana Y terhubung ke Z", atau "di mana Q dipakai", jalankan kueri sebelum membuka satu berkas pun:

```bash
graphify query "apa yang memanggil periksaBatas"
graphify path "rutaAuth" "pembatas_laju"      # jalur terpendek dua simpul
graphify explain "cariSesiSah"                # penjelasan satu simpul
```

Membaca ulang lima berkas untuk menjawab satu pertanyaan hubungan adalah pemborosan yang sudah ada alatnya.

**Perbarui sesudah satu tahap §8.1 selesai**, bukan setiap kali menyimpan berkas:

```bash
graphify update .       # ekstraksi ulang kode, TANPA kunci LLM
```

**Bentuknya `graphify update .`, bukan `graphify . --update`.** Keduanya ada dan berbeda: yang kedua menyarikan dokumen pula, sehingga menuntut kunci LLM dan berhenti dengan `no LLM API key found` sebelum menyentuh satu pun berkas kode.

Tahap yang menambah lapisan baru — rute, tabel, adapter — mengubah bentuk graf secara berarti. Suntingan di dalam satu fungsi tidak.

**Pelabelan komunitas menuntut kunci LLM, dan pengelompokan ulang menghapusnya.** Setiap pembaruan mengelompokkan ulang seluruh graf; komunitas yang bentuknya berubah kehilangan namanya dan kembali menjadi `Community 37`. Menamainya kembali adalah `graphify label .`, yang menuntut kunci — sehingga sesudah pembaruan besar, **navigasi lewat nama komunitas berhenti dapat diandalkan** sementara kueri simpul dan jalur tetap sahih.

#### Batas yang wajib diingat

**Graf bukan sumber kebenaran, dan tidak pernah menjadi.** Apabila graf dan dokumen `context/` berbeda, **dokumen yang berlaku** — tanpa pengecualian. Graf diturunkan dari kode; kode diturunkan dari dokumen. Membalik urutan itu menjadikan kekeliruan kode tampak seperti ketentuan.

**Graf boleh usang, dan tidak memberi tahu ketika usang.** Ia memotret keadaan pada saat dibangun. Sesudah tahap baru selesai tanpa `--update`, jawabannya menyesatkan dengan percaya diri. Inilah alasan pembaruannya diikat pada gerbang tahap, bukan pada kebiasaan.

**Pemeriksaan kesehatan menandai 134 sisi berujung menggantung.** Sebabnya penyarian dokumen menghasilkan pengenal simpul yang tidak selalu cocok dengan pengenal yang dibangkitkan AST, sehingga sebagian sisi menunjuk simpul yang tidak ada. Akibatnya: **hubungan yang dilaporkan graf sahih, tetapi ketiadaan hubungan tidak membuktikan apa-apa.** Graf boleh dipakai menemukan, tidak boleh dipakai menyimpulkan bahwa sesuatu tidak terhubung.

**`graphify-out/` tidak dilacak git** — ia selalu dapat dibangun ulang, dan versinya akan bertabrakan pada setiap penggabungan. Sudah tercantum pada `.gitignore`. Cache penyarian di dalamnya membuat `--update` berikutnya hanya membayar berkas yang berubah.

**Kunci API belum disetel.** Kode diekstrak lewat AST tanpa LLM dan tanpa biaya; dokumen disarikan agen yang sedang berjalan. Menyetel `GEMINI_API_KEY` memindahkan penyarian dokumen ke Gemini dan mempercepatnya, dan itu keputusan pemilik mesin — bukan agen.

---

## Riwayat

| Tanggal | Perubahan |
|---|---|
| 11 Agustus 2026 | §8.1 — dinyatakan bahwa Jalur A seluruhnya backend dan **frontend berada di luar cakupan agen**. Sebelumnya hal ini tidak tertulis di mana pun, sehingga peta tahapan tampak lengkap padahal tidak memuat frontend sama sekali |
| 11 Agustus 2026 | §8 — **urutan berubah menjadi lokal lebih dahulu.** Jalur B ditahan setelah B1 sampai seluruh fitur Jalur A berjalan setempat. Dicatat pula bahwa gerbang pengukuran render A7 tidak dapat ditutup tanpa Lambda |
| 6 Agustus 2026 | Dokumen dibuat. Menetapkan alur kerja agen ECC di atas rantai penguncian EduTrack: peta baca per jenis tugas, prosedur ketika kode dan dokumen bertentangan, dua belas larangan mutlak, tiga tingkat pengujian termasuk pembuktian penegakan oleh basis data, konvensi penamaan lintas lapisan, serta delapan tahap implementasi beserta gerbang selesainya |
| 7 Agustus 2026 | §5.3 diperluas: lima aturan migrasi dinyatakan lengkap, ditambah header klasifikasi wajib, konvensi penamaan `expand`/`contract`, kewajiban `grep` sebelum `contract`, dan kewajiban lolos `squawk`. Mengikuti [DEPLOYMENT.md §6.5](DEPLOYMENT.md) dan CK-D-03 |
| 7 Agustus 2026 | **Versi 2.0.** Pasal 8 ditulis ulang menjadi **dua jalur yang berjalan bersamaan** — Jalur A dikerjakan agen tanpa menyentuh AWS, Jalur B dikerjakan manusia — karena setiap jalur menuju kuasa AWS menuntut kode MFA sehingga agen tidak dapat menaikkan infrastruktur. Ditambahkan **§10 titik henti manusia**, **§11 git dan pemulihan** yang mengikat riwayat git pada rantai pemulihan produksi, dan **§12 memulai dari repositori kosong** |
| 7 Agustus 2026 | Ditambahkan **§13 alat bantu ingatan dan penelusuran**: `engram` sebagai ingatan lintas sesi lewat MCP dengan nama proyek dipatok eksplisit, dan `graphify` sebagai graf pengetahuan atas kode. Ditegaskan bahwa keduanya tidak pernah menjadi sumber kebenaran, dan isi dokumen `context/` tidak boleh disalin ke dalam engram karena menghasilkan sumber kedua yang akan menyimpang |
| 8 Agustus 2026 | **Versi 2.2 — disesuaikan dengan apa yang terbukti pada A2 dan A3.** §2 Fase 4 kini menyebut tiga perintah gerbang secara eksplisit, karena `npm run periksa` sendirian tidak menjalankan linter migrasi maupun bukti penegakan basis data. §4.1 menyatakan ambang `domain/` dipatok pada keempat metrik dan ambang global 80% baru menyala pada A5 beserta alasannya, serta mewajibkan setiap ambang dibuktikan dapat merah sebelum dipercaya. §4.2 menyebut perintah yang menjalankannya beserta alasan tesnya berurutan dan berbenih cadangan. §5.3 diperluas dengan baris `SET LOCAL` batas kunci dan batas pernyataan, konfigurasi `.squawk.toml` yang wajib berawalan titik, dan larangan menyunting migrasi yang sudah diterapkan. §6 menetapkan apa yang dilakukan ketika harness melarang pemanggilan subagen: tinjauan keamanan **berhenti dan melapor**, tidak diganti tinjauan sendiri. §12 langkah 7 dan §13 disesuaikan dengan keadaan yang sebenarnya |
| 8 Agustus 2026 | §10 disesuaikan. Tiga pertanyaan sekolah — S-04, T-02, dan S-02 — sudah terjawab dan dikeluarkan dari daftar titik henti; barisnya diganti satu paragraf yang mencatat jawabannya. Baris nama domain diperbarui mengikuti **CK-17**: yang belum ada hanya namanya, bentuk DNS-nya sudah ditetapkan, dan penerapannya **sengaja dikerjakan paling akhir** tanpa menahan satu pun tahap Jalur A |
| 8 Agustus 2026 | §13.2 ditulis ulang sesudah graf benar-benar dibangun: 354 simpul, 600 sisi, 20 komunitas berlabel. Ditetapkan **kewajiban menanyai graf lebih dahulu** untuk pertanyaan hubungan, dan pembaruan diikat pada gerbang tahap §8.1. Dicatat pula tiga batasnya — graf bukan sumber kebenaran, graf boleh usang tanpa memberi tahu, dan 134 sisi berujung menggantung menjadikan **ketiadaan hubungan tidak membuktikan apa-apa** |
| 12 Agustus 2026 | §13.2 disesuaikan sesudah Jalur B: graf kini 1.263 simpul dan 2.582 sisi dari 196 berkas. Dua koreksi yang menentukan — perintah pembaruannya `graphify update .`, **bukan** `graphify . --update` yang menuntut kunci LLM; dan pengelompokan ulang **menghapus label komunitas**, sehingga hanya sekitar 16 dari 75 yang masih bernama dan navigasi lewat nama komunitas berhenti dapat diandalkan sampai `graphify label .` dijalankan |
| 10 Agustus 2026 | **Versi 2.3 — delivery-first dan hemat token.** §6 tidak lagi menetapkan kelas model tertentu. Orkestrasi sekarang didasarkan pada artefak, risiko, dan bukti selesai: satu pemilik per irisan RED–GREEN, delegasi hanya untuk kerja berbatas dan independen, maksimal dua reviewer pada gelombang biasa, parallelism bersyarat, re-review terfokus, keluaran ringkas, dan full gate pada milestone terintegrasi serta keadaan final |
