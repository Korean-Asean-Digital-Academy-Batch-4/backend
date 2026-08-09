# A5 Administrasi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun seluruh administrasi A5 untuk AC-01, AC-02, AC-03, AC-04, AC-22, AC-24, AC-26, dan AC-28 tanpa mengubah scope PRD maupun kewenangan aktor.

**Architecture:** Express menangani HTTP, Zod, sesi, peran, multipart, dan amplop respons. Query serta transaksi A5 memakai Drizzle di atas `pg.Pool`; parser/pembentuk CSV dan XLSX berada di adapter lokal melalui port. Mutasi akun massal, aktivasi periode, penggantian komponen, reset kata sandi, dan pembuatan kelas masing-masing selesai dalam satu transaksi PostgreSQL.

**Tech Stack:** Node.js 24+, TypeScript strict, Express 5, Zod 3, Drizzle ORM/node-postgres, Busboy 1.6.0, csv-parse 7.0.2, csv-stringify 6.8.3, read-excel-file 9.3.8, write-excel-file 4.1.1, yauzl 3.4.0, Vitest 2, Testcontainers, PostgreSQL 17.

## Global Constraints

- Jangan menyentuh AWS, Terraform, kredensial, rahasia, atau perintah `aws`.
- Jangan mengubah `../context/PRD.md` maupun `../context/aktor-role.md`.
- Ikuti dua belas larangan `AGENTS.md` §3.2 dan berhenti pada titik henti §10.
- Semua kosakata domain memakai Bahasa Indonesia; bidang HTTP memakai `snake_case`.
- Tidak ada migrasi baru: tabel dan constraint A5 sudah ada pada migrasi 0001–0010.
- Tidak ada raw SQL baru pada kode produksi A5; ekspresi `sql` bertipe milik Drizzle boleh dipakai ketika query builder memerlukannya. DDL mentah hanya boleh ada pada fixture Testcontainers untuk memasang/melepas trigger fault-injection yang terisolasi.
- Unggah dibatasi 10 kali per jam per pengguna dan 2 MiB per berkas.
- Satu berkas bermasalah membatalkan seluruh mutasi dan melaporkan seluruh baris bermasalah.
- Respons kata sandi dan CSV kredensial memakai `Cache-Control: no-store`; kata sandi/hash/data pribadi tidak masuk log.
- Setiap fungsi produksi harus didahului tes yang terlihat gagal karena perilakunya belum ada.
- Setiap commit harus hijau untuk `npm run periksa`, `npm run lint:migrations`, dan `npm run test:db`; `npm run coverage:global` diaktifkan pada Task 9 setelah kode A5 tersedia dan wajib hijau sebelum PR.
- Cakupan gabungan dua suite minimal 80% untuk statements, branches, functions, dan lines; `src/domain/**/*.ts` tetap 100%.
- Commit dokumen `ab87998`, `7d6c84d`, `b38189d`, `ad15484`, dan `9c72b22` pada repo Docs adalah kontrak yang mendahului kode.

## Final Wiring and Shared Result Types

Kepemilikan tipe tidak dibiarkan implisit:

- `src/dependensi-app.ts` memiliki `DependensiApp` dan baru dibuat pada Task 3 setelah semua port yang dirujuk tersedia.
- `src/db/administrasi/hasil.ts` memiliki `JenisGalatAdministrasi` dan `HasilAdministrasi` mulai Task 2.
- DTO request/repository/response dimiliki modul fitur yang pertama memakainya: `pengguna.ts`, `periode.ts`, `mapel.ts`, `komponen.ts`, `pratinjau-kelas.ts`, atau `kelas.ts`. Bentuk kanoniknya ditulis pada bagian **Interfaces** task masing-masing; tidak ada tipe placeholder yang dibiarkan untuk ditebak implementer.

`buatApp` menerima seluruh adapter dari composition root; ia tidak membangun dependency sendiri:

```ts
export type DependensiApp = Readonly<{
  pool: Pool;
  db: BasisData;
  kataSandi: KataSandi;
  berkasAdministrasi: BerkasAdministrasi;
  sekarang: () => Date;
}>;

export type JenisGalatAdministrasi =
  | "tidak_ditemukan"
  | "data_sudah_ada"
  | "guru_sudah_mengampu"
  | "guru_belum_mengampu"
  | "komponen_sudah_dipakai"
  | "jenjang_tidak_cocok"
  | "bobot_tidak_seratus"
  | "berkas_tidak_sah";

export type HasilAdministrasi<T> =
  | Readonly<{ berhasil: true; data: T }>
  | Readonly<{
      berhasil: false;
      jenis: JenisGalatAdministrasi;
      pesan: string;
      rincian?: readonly unknown[];
    }>;
```

`src/entry/server.ts` membangun satu `Pool`, satu `BasisData`, satu adapter kata sandi, satu adapter berkas, dan fungsi waktu nyata, lalu menyuntikkannya ke `buatApp`. `tests/db/rute-auth.test.ts` dan seluruh test app baru memakai helper yang membangun bentuk sama dengan pool uji. Known constraint/database conflicts diubah menjadi `HasilAdministrasi`; galat tak terduga tetap dilempar ke error handler 500 yang sudah menyamarkan rinciannya.

---

### Task 1: Harness cakupan gabungan dua suite

**Files:**

- Create: `scripts/cakupan-global.ts`
- Create: `tests/unit/cakupan-global.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.config.db.ts`

**Interfaces:**

- Produces: `ringkasCakupan(peta: readonly CoverageMapData[]): RingkasanCakupan`
- Produces: `periksaAmbang(ringkasan: RingkasanCakupan, ambang: number): readonly MetrikCakupan[]`
- Produces: `npm run coverage:gabung`, yang menjalankan kedua suite, menggabungkan JSON Istanbul, dan mencetak empat angka tanpa mengaktifkan ambang final sebelum implementasi A5 tersedia.
- Produces exact package scripts:

```json
{
  "coverage:bersihkan": "node --input-type=module -e \"import{rmSync}from'node:fs';for(const p of['coverage/unit','coverage/db'])rmSync(p,{recursive:true,force:true})\"",
  "coverage:unit-json": "vitest run --coverage --coverage.reporter=json --coverage.reportsDirectory=coverage/unit",
  "coverage:db-json": "vitest run --config vitest.config.db.ts --coverage --coverage.reporter=json --coverage.reportsDirectory=coverage/db",
  "coverage:gabung": "npm run coverage:bersihkan && npm run coverage:unit-json && npm run coverage:db-json && tsx scripts/cakupan-global.ts --ambang=0"
}
```

- [ ] **Step 1: Write the failing unit tests**

```ts
it("menggabungkan hit dua suite atas berkas yang sama", () => {
  const ringkasan = ringkasCakupan([petaDenganHit(1), petaDenganHit(0)]);
  expect(ringkasan.statements).toBe(100);
});

it("menyebut setiap metrik yang berada di bawah ambang", () => {
  expect(periksaAmbang({ statements: 81, branches: 79, functions: 78, lines: 82 }, 80)).toEqual([
    "branches",
    "functions",
  ]);
});
```

Tambahkan tes CLI yang menjalankan proses anak atas fixture di direktori sementara: dua artifact sah digabung; artifact hilang atau JSON rusak keluar non-zero dengan pesan aman; `--ambang` hilang/bukan angka ditolak; ambang di atas hasil keluar non-zero; ambang di bawah hasil keluar 0. Seluruh direktori sementara dihapus pada `finally`.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/unit/cakupan-global.test.ts`

Expected: FAIL karena `scripts/cakupan-global.ts` belum ada.

- [ ] **Step 3: Implement the typed merger and CLI**

```ts
export const AMBANG_CAKUPAN_GLOBAL = 80;
export type MetrikCakupan = "statements" | "branches" | "functions" | "lines";
export type RingkasanCakupan = Readonly<Record<MetrikCakupan, number>>;

export function periksaAmbang(
  ringkasan: RingkasanCakupan,
  ambang: number,
): readonly MetrikCakupan[] {
  return (Object.keys(ringkasan) as MetrikCakupan[]).filter((metrik) => ringkasan[metrik] < ambang);
}
```

Tambahkan direct dev dependency `istanbul-lib-coverage@3.2.2` dan `@types/istanbul-lib-coverage@2.0.6`. Kedua config menghasilkan `json` selain laporan teks; skrip global membaca `coverage/unit/coverage-final.json` dan `coverage/db/coverage-final.json` yang baru dibuat oleh perintah yang sama.

- [ ] **Step 4: Verify GREEN and verify the merger**

Run:

```bash
npm test -- tests/unit/cakupan-global.test.ts
npm run coverage:gabung
```

Expected: tes fungsi dan CLI PASS; laporan baseline gabungan mencatat sekitar 83.44% statements, 89.71% branches, 65.51% functions, dan 83.44% lines. Task ini hanya membuktikan merger/reporting—ambang final sengaja belum aktif. Rendahnya functions adalah pekerjaan A5, bukan alasan mengecualikan sumber.

- [ ] **Step 5: Run gates and commit**

```bash
npm run periksa
npm run lint:migrations
npm run test:db
git add scripts/cakupan-global.ts tests/unit/cakupan-global.test.ts package.json package-lock.json vitest.config.ts vitest.config.db.ts
git commit -m "test: ukur cakupan gabungan dua suite pada A5"
```

Sebelum commit, review `code-reviewer`, `typescript-reviewer`, dan silent-failure reviewer atas parsing argumen, stale artifacts, dan exit code.

---

### Task 2: Fondasi Drizzle dan kewenangan Administrator

**Files:**

- Create: `src/db/drizzle.ts`
- Create: `src/db/administrasi/hasil.ts`
- Create: `src/routes/middleware-kewenangan.ts`
- Create: `tests/unit/routes/middleware-kewenangan.test.ts`
- Create: `tests/unit/db/drizzle.test.ts`
- Modify: `src/routes/amplop.ts`

**Interfaces:**

- Produces: `type BasisData = NodePgDatabase<typeof skema>`
- Produces: `buatBasisData(pool: Pool): BasisData`
- Produces: `wajibAdministrator(): RequestHandler`
- Owns the shared `JenisGalatAdministrasi` and `HasilAdministrasi<T>` definitions shown above in `src/db/administrasi/hasil.ts`.

- [ ] **Step 1: Write failing authorization tests**

```ts
it.each(["guru", "siswa"] as const)("menolak peran %s dengan 403", (peran) => {
  const { req, res, next } = konteksMiddleware({ peran });
  wajibAdministrator()(req, res, next);
  expect(res.statusCode).toBe(403);
  expect(res.badan.kesalahan.kode).toBe("KEWENANGAN_DITOLAK");
  expect(next).not.toHaveBeenCalled();
});

it("meneruskan Administrator", () => {
  const { req, res, next } = konteksMiddleware({ peran: "administrator" });
  wajibAdministrator()(req, res, next);
  expect(next).toHaveBeenCalledOnce();
});
```

Tambahkan RED untuk `buatBasisData`:

```ts
it("membuat executor Drizzle bertipe dari satu pool", () => {
  const db = buatBasisData(poolTiruan);
  expect(db.select).toBeTypeOf("function");
  expect(db.transaction).toBeTypeOf("function");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/unit/routes/middleware-kewenangan.test.ts tests/unit/db/drizzle.test.ts`

Expected: FAIL karena middleware dan kode A5 belum ada.

- [ ] **Step 3: Implement minimal middleware and Drizzle wrapper**

```ts
export function wajibAdministrator(): RequestHandler {
  return (req, res, berikutnya) => {
    if (req.penuntut?.peran !== "administrator") {
      kirimKesalahan(
        res,
        403,
        KODE.kewenanganDitolak,
        "Anda tidak berwenang melakukan tindakan ini.",
      );
      return;
    }
    berikutnya();
  };
}
```

Tambahkan kode katalog `kewenanganDitolak`, `berkasTidakSah`, `berkasTerlaluBesar`, `bobotTidakSeratus`, `dataSudahAda`, `guruSudahMengampu`, `guruBelumMengampu`, `komponenSudahDipakai`, dan `jenjangTidakCocok` persis seperti `API.md` §10.

- [ ] **Step 4: Verify GREEN, gates, and commit**

```bash
npm test -- tests/unit/routes/middleware-kewenangan.test.ts
npm run periksa
npm run lint:migrations
npm run test:db
git add src/db/drizzle.ts src/db/administrasi/hasil.ts src/routes/middleware-kewenangan.ts src/routes/amplop.ts tests/unit/routes/middleware-kewenangan.test.ts tests/unit/db/drizzle.test.ts
git commit -m "feat: tegakkan kewenangan Administrator pada A5 (AC-03, AC-28)"
```

Sebelum commit, review `code-reviewer`, `typescript-reviewer`, dan silent-failure reviewer.

---

### Task 3: Multipart, CSV, XLSX, templat, dan pembatas unggah aman

**Files:**

- Create: `src/dependensi-app.ts`
- Create: `src/ports/berkas-administrasi.ts`
- Create: `src/adapters/local/berkas-administrasi/csv.ts`
- Create: `src/adapters/local/berkas-administrasi/xlsx.ts`
- Create: `src/adapters/local/berkas-administrasi/index.ts`
- Create: `src/routes/multipart.ts`
- Create: `src/db/administrasi/pembatas-unggah.ts`
- Create: `src/routes/administrasi/templat.ts`
- Create: `tests/unit/adapters/berkas-administrasi.test.ts`
- Create: `tests/unit/routes/multipart.test.ts`
- Create: `tests/db/bantuan-rute.ts`
- Create: `tests/db/fixture-administrasi.ts`
- Create: `tests/db/pembatas-unggah.test.ts`
- Create: `tests/db/rute-templat.test.ts`
- Modify: `src/app.ts`
- Modify: `src/entry/server.ts`
- Modify: `tests/db/rute-auth.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

```ts
export type BarisAkun = Readonly<{ baris: number; nama: string; namaPengguna: string }>;
export type BarisSiswa = Readonly<{ baris: number; kelas: string; nis: string; nama: string }>;
export type RincianBerkas = Readonly<{ baris: number; sebab: string }>;
export type RincianSiswaBermasalah = Readonly<{ baris: number; nis: string; sebab: string }>;
export type KredensialAwal = Readonly<{
  nama: string;
  namaPengguna: string;
  kataSandiAwal: string;
}>;

export type HasilUrai<T, R extends RincianBerkas> =
  | Readonly<{ berhasil: true; valid: readonly T[]; bermasalah: readonly R[] }>
  | Readonly<{ berhasil: false; sebab: string }>;

export interface BerkasAdministrasi {
  uraiAkunCsv(
    berkas: Buffer,
    peran: "guru" | "siswa",
  ): Promise<HasilUrai<BarisAkun, RincianBerkas>>;
  uraiDaftarSiswaXlsx(berkas: Buffer): Promise<HasilUrai<BarisSiswa, RincianSiswaBermasalah>>;
  buatCsvKredensial(baris: readonly KredensialAwal[]): Promise<Buffer>;
  buatTemplatAkunCsv(peran: "guru" | "siswa"): Promise<Buffer>;
  buatTemplatDaftarSiswaXlsx(): Promise<Buffer>;
}
```

Test infrastructure created in this task has exact ownership:

```ts
export function nyalakanAppUji(pilihan?: Partial<DependensiApp>): Promise<AppUji>;
export function panggilJson(app: AppUji, jalan: string, pilihan?: PilihanJson): Promise<JawabanUji>;
export function panggilMultipart(app: AppUji, jalan: string, form: FormData): Promise<JawabanUji>;
export function masukSebagai(app: AppUji, namaPengguna: string): Promise<string>;
export function bersihkanDataAdministrasi(): Promise<void>;
export type BarisFixtureAkun = Readonly<{ nama: string; namaPengguna: string }>;
export type BarisFixtureSiswa = Readonly<{ kelas: string; nis: string; nama: string }>;
export function csvAkun(peran: "guru" | "siswa", baris: readonly BarisFixtureAkun[]): Buffer;
export function xlsxSiswa(baris: readonly BarisFixtureSiswa[]): Promise<Buffer>;
export type TabelPemicuGagal =
  "sesi_masuk" | "periode" | "kelas_siswa" | "penugasan" | "penugasan_komponen" | "rapor";
export function pasangPemicuGagal(tabel: TabelPemicuGagal): Promise<() => Promise<void>>;
export function pasangPemicuGagalAktivasiPeriode(periodeRef: string): Promise<() => Promise<void>>;
export function pulihkanKomponenAwal(): Promise<void>;
```

Definisi helper HTTP juga kanonik, bukan placeholder:

```ts
export type AppUji = Readonly<{ asal: string; tutup: () => Promise<void> }>;
export type PilihanJson = Readonly<{
  metode?: "GET" | "POST" | "PATCH" | "PUT";
  sesi?: string;
  badan?: unknown;
}>;
export type JawabanUji = Readonly<{
  status: number;
  kepala: Headers;
  badan: unknown;
}>;
```

`panggilJson` dan `panggilMultipart` selalu menargetkan `app.asal`; `masukSebagai` mengembalikan cookie sesi melalui kredensial fixture yang dimiliki suite; `AppUji.tutup()` menutup listener tanpa menggantung. Setiap file DB A5 membuat app pada `beforeAll`, menjalankan `bersihkanDataAdministrasi()` pada `beforeEach` dan `afterEach`, lalu menutup app pada `afterAll`. Cleanup menghapus trigger uji, kunci `pembatas_laju` A5, sesi fixture, dan seluruh fixture berawalan `uji-a5-` dalam urutan FK terbalik tanpa menyentuh benih bersama. Suite komponen juga memanggil `pulihkanKomponenAwal()` dalam transaksi pada `beforeEach` dan `afterEach` agar delapan komponen benih, ID, bobot, dan urutan kembali persis sebelum suite lain berjalan. `pasangPemicuGagal` menerima union tabel allowlist di atas dan membuat trigger PostgreSQL uji yang `RAISE EXCEPTION`; varian periode hanya meledak ketika baris target diubah menjadi aktif sehingga deactivation sibling benar-benar diuji rollback. Keduanya selalu mengembalikan fungsi pelepas yang dipanggil pada `finally`.

Nama singkat pada contoh task selanjutnya (`panggilAdmin`, `unggahCsv`, `pratinjau`, `buatKelas`, dan helper hitung) adalah wrapper lokal di file test pemiliknya; masing-masing wajib didefinisikan sebelum test pertama dengan mendelegasikan HTTP ke `panggilJson`/`panggilMultipart` atau query pemeriksaan ke pool Testcontainers. Tidak ada helper global tersirat di luar signature kanonik di atas.

- [ ] **Step 1: Install only the audited packages**

```bash
npm install busboy@1.6.0 csv-parse@7.0.2 csv-stringify@6.8.3 read-excel-file@9.3.8 write-excel-file@4.1.1 yauzl@3.4.0
npm install -D @types/busboy@1.5.4 @types/yauzl@3.4.0
npm audit --omit=dev
```

Expected: production audit reports 0 vulnerabilities. Do not install `xlsx` or `exceljs`.

- [ ] **Step 2: Write failing parser and multipart tests**

Cover exact headers `Nama,NIP`, `Nama,NIS`, and `Kelas,NIS,Nama`; UTF-8 BOM; empty fields; non-digit NIP/NIS; duplicate headers; more than 360 data rows; more than one XLSX worksheet; ZIP with more than 64 entries; total uncompressed ZIP size above 16 MiB; file missing; two files; a 2 MiB + 1 byte stream; and CSV formula prefixes `=`, `+`, `-`, `@` in every exported text cell.

```ts
it("menolak aliran segera setelah batas 2 MiB", async () => {
  const jawab = await ujiPembacaMultipart(Buffer.alloc(2 * 1024 * 1024 + 1));
  expect(jawab.status).toBe(413);
  expect(jawab.badan.kesalahan.kode).toBe("BERKAS_TERLALU_BESAR");
});

it("menetralkan formula pada CSV kredensial", async () => {
  const csv = await berkas.buatCsvKredensial([
    { nama: '=HYPERLINK("https://jahat")', namaPengguna: "001", kataSandiAwal: "aman" },
  ]);
  expect(csv.toString("utf8")).toContain("'=HYPERLINK");
});
```

`ujiPembacaMultipart` adalah helper lokal `tests/unit/routes/multipart.test.ts` yang membangun `Readable` dan header multipart sintetis untuk fungsi pembaca; namanya sengaja berbeda dari helper integrasi `panggilMultipart(app, jalan, form)`.

- [ ] **Step 3: Verify RED**

Run: `npm test -- tests/unit/adapters/berkas-administrasi.test.ts tests/unit/routes/multipart.test.ts`

Expected: FAIL karena port, adapter, dan pembaca multipart belum ada.

- [ ] **Step 4: Implement bounded parsing**

Gunakan konstanta bernama berikut:

```ts
export const BATAS_UNGGAH_BYTE = 2 * 1024 * 1024;
export const BATAS_BARIS_UNGGAH = 360;
export const BATAS_ENTRI_XLSX = 64;
export const BATAS_XLSX_TIDAK_TERKOMPRESI_BYTE = 16 * 1024 * 1024;
```

Busboy memakai `files: 1`, `fields: 2`, `parts: 3`, `fileSize: BATAS_UNGGAH_BYTE`, dan `fieldSize: 16 * 1024`. Abaikan nama file dari klien. Sebelum `read-excel-file`, baca central directory secara lazy dengan yauzl, jumlahkan `uncompressedSize`, batasi entry, dan pastikan tepat satu `xl/worksheets/sheet*.xml`. CSV memakai `max_record_size: 4096`, `columns: false`, dan menghentikan parsing setelah kepala + 360 baris. Hasil XLSX mempertahankan nilai `kelas` setiap baris valid tanpa memilih satu nilai kanonik, sehingga Task 7 dapat menghitung tepat satu nilai unik atau menghasilkan `kelas_berkas: null` beserta seluruh rincian baris.

- [ ] **Step 5: Write and verify RED for template routes and quota**

`tests/db/rute-templat.test.ts` lebih dahulu membuktikan 401 tanpa sesi, 403 untuk Guru/Siswa, 400 untuk query peran hilang/salah, exact CSV headers/filenames, XLSX one-sheet headers, dan tidak ada hash/password. `tests/db/pembatas-unggah.test.ts` memanggil `pakaiJatahUnggah` 11 kali pada jendela yang sama: 1–10 diizinkan, 11 ditolak, pengguna kedua tetap diizinkan, dan jendela berikutnya pulih.

Run:

```bash
npm run test:db -- tests/db/rute-templat.test.ts tests/db/pembatas-unggah.test.ts
```

Expected: template endpoint masih 404 dan fungsi quota belum ada.

- [ ] **Step 6: Add template routes, app wiring, and atomic upload allowance**

`GET /api/templat/pengguna.csv?peran=guru|siswa` serta `GET /api/templat/daftar-siswa.xlsx` memakai `wajibMasuk` dan `wajibAdministrator`. Buat `pakaiJatahUnggah(db, penggunaRef, sekarang)` sebagai satu UPSERT bersyarat pada kunci `unggah:<uuid>`: percobaan 1–10 diizinkan, percobaan ke-11 ditolak sampai awal jendela satu jam berikutnya. Semua tiga endpoint multipart berbagi kunci yang sama. `src/dependensi-app.ts` mengekspor bentuk final `DependensiApp` pada bagian awal plan.

`src/entry/server.ts` membuat `db: buatBasisData(pool)`, `berkasAdministrasi: berkasAdministrasiLokal()`, dan `sekarang: () => new Date()`. `tests/db/rute-auth.test.ts` berpindah ke `nyalakanAppUji` supaya final `DependensiApp` dipakai oleh seluruh caller. Ketika Busboy memicu `limit`, `filesLimit`, `fieldsLimit`, `partsLimit`, atau request abort, hentikan pembacaan file, resume/drain stream yang tersisa, lepaskan listener, dan selesaikan promise tepat sekali agar request tidak menggantung.

- [ ] **Step 7: Verify GREEN, security review, gates, and commit**

```bash
npm test -- tests/unit/adapters/berkas-administrasi.test.ts tests/unit/routes/multipart.test.ts
npm run test:db -- tests/db/rute-templat.test.ts tests/db/pembatas-unggah.test.ts
npm audit --omit=dev
npm run periksa
npm run lint:migrations
npm run test:db
git add package.json package-lock.json src/dependensi-app.ts src/ports/berkas-administrasi.ts src/adapters/local/berkas-administrasi src/routes/multipart.ts src/db/administrasi/pembatas-unggah.ts src/routes/administrasi/templat.ts src/app.ts src/entry/server.ts tests/unit/adapters/berkas-administrasi.test.ts tests/unit/routes/multipart.test.ts tests/db/bantuan-rute.ts tests/db/fixture-administrasi.ts tests/db/pembatas-unggah.test.ts tests/db/rute-templat.test.ts tests/db/rute-auth.test.ts
git commit -m "feat: proses berkas administrasi dengan batas keras (AC-26)"
```

Wajib review code, TypeScript, database, `security-reviewer`, dan silent failure sebelum commit; selesaikan semua CRITICAL/HIGH.

---

### Task 4: Akun manual, daftar, reset, dan unggah atomik

**Files:**

- Create: `src/db/administrasi/pengguna.ts`
- Create: `src/routes/administrasi/pengguna.ts`
- Create: `src/routes/administrasi/hash-kata-sandi.ts`
- Create: `tests/unit/routes/hash-kata-sandi.test.ts`
- Create: `tests/db/rute-pengguna.test.ts`
- Modify: `src/ports/kata-sandi.ts`
- Modify: `src/adapters/local/kata-sandi.ts`
- Modify: `src/app.ts`

**Interfaces:**

- Extend `KataSandi` with `buatAwal(): string` so routes never import the local adapter.
- Produce the following exact repository and route interfaces:

```ts
export type PenggunaRingkas = Readonly<{
  id: string;
  nama: string;
  namaPengguna: string;
  peran: "guru" | "siswa";
  aktif: boolean;
}>;

export type PenggunaTersandiBaru = Readonly<{
  nama: string;
  namaPengguna: string;
  peran: "guru" | "siswa";
  kataSandiHash: string;
}>;

export type PenggunaTersandiUnggah = PenggunaTersandiBaru & Readonly<{ baris: number }>;

export function buatPengguna(
  db: BasisData,
  input: PenggunaTersandiBaru,
): Promise<HasilAdministrasi<PenggunaRingkas>>;
export function daftarPengguna(db: BasisData): Promise<readonly PenggunaRingkas[]>;
export function buatBanyakPengguna(
  db: BasisData,
  input: readonly PenggunaTersandiUnggah[],
): Promise<HasilAdministrasi<readonly PenggunaRingkas[]>>;
export function resetKataSandi(
  db: BasisData,
  penggunaRef: string,
  hashBaru: string,
): Promise<HasilAdministrasi<null>>;
export function rutaPengguna(
  deps: Pick<DependensiApp, "pool" | "db" | "kataSandi" | "berkasAdministrasi" | "sekarang">,
): Router;
export const KONKURENSI_HASH_UNGGAH = 4;
```

- [ ] **Step 1: Write failing HTTP/DB tests**

Cover unauthenticated 401, Guru/Siswa 403 pada seluruh empat endpoint, unknown fields 400, `peran=administrator` 400, manual 201 + `no-store`, exact profile row, case-insensitive I-02 conflict, list terurut tanpa Administrator/hash, reset Guru/Siswa + `no-store`, reset ID Administrator 404, reset hash plus all session rows in one transaction, trigger gagal pada penghapusan sesi yang me-roll back hash, one bad row leaves zero users, duplicate within file plus duplicate in DB returns every row, 2 MiB limit, and upload attempt 11 returns 429 with `coba_lagi_pada`.

Untuk CSV sukses, RED wajib mengunci `Cache-Control: no-store`, `Content-Type: text/csv; charset=utf-8`, dan `Content-Disposition: attachment; filename="kredensial-<peran>-YYYY-MM-DD.csv"`. Tanggal berasal dari `deps.sekarang()` yang diformat pada zona `Asia/Jakarta` sesuai API §2.4 dan `<peran>` persis `guru` atau `siswa`; respons dan isi CSV tidak boleh memuat hash.

Unit test `hash-kata-sandi.test.ts` memakai fake `KataSandi` yang mencatat pekerjaan aktif dan membuktikan 360 hash selesai dengan maksimum empat promise aktif sekaligus, urutan hasil sama dengan urutan input, dan rejection menghentikan hasil tanpa membuka transaksi.

```ts
it("membatalkan seluruh CSV ketika satu baris sudah terdaftar", async () => {
  const sebelum = await hitungPengguna();
  const jawab = await unggahCsv("Nama,NIP\nBaru,111\nDuplikat,198001011001\n");
  expect(jawab.status).toBe(400);
  expect(jawab.badan.kesalahan.kode).toBe("BERKAS_TIDAK_SAH");
  expect(await hitungPengguna()).toBe(sebelum);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run test:db -- tests/db/rute-pengguna.test.ts
npm test -- tests/unit/routes/hash-kata-sandi.test.ts
```

Expected: endpoint menjawab 404 dan unit worker pool gagal karena implementasinya belum ada.

- [ ] **Step 3: Implement account transactions**

Hash seluruh kata sandi setelah semua validasi file selesai dan sebelum membuka transaksi, dengan worker pool `KONKURENSI_HASH_UNGGAH=4`—bukan `Promise.all` 360 Argon2. Pertahankan `baris` melalui hashing dan input repository agar unique violation atau race dapat dipetakan kembali ke seluruh rincian baris. Di dalam transaksi, sisipkan setiap `pengguna` lalu tepat satu profil `guru` atau `siswa`. Reset melakukan `UPDATE pengguna WHERE peran IN ('guru','siswa')` dan `DELETE sesi_masuk` pada executor transaksi yang sama. Petakan constraint ke `DATA_SUDAH_ADA` atau rincian `BERKAS_TIDAK_SAH`; jangan mengembalikan pesan PostgreSQL.

- [ ] **Step 4: Verify GREEN, review, gates, and commit**

```bash
npm run test:db -- tests/db/rute-pengguna.test.ts
npm test -- tests/unit/routes/hash-kata-sandi.test.ts
npm run periksa
npm run lint:migrations
npm run test:db
git add src/db/administrasi/pengguna.ts src/routes/administrasi/pengguna.ts src/routes/administrasi/hash-kata-sandi.ts src/ports/kata-sandi.ts src/adapters/local/kata-sandi.ts src/app.ts tests/unit/routes/hash-kata-sandi.test.ts tests/db/rute-pengguna.test.ts
git commit -m "feat: kelola akun Guru dan Siswa atomik (AC-01, AC-26, AC-28)"
```

Review code, TypeScript, database, security, dan silent failure; selesaikan semua CRITICAL/HIGH.

---

### Task 5: Tahun ajaran dan periode aktif

**Files:**

- Create: `src/db/administrasi/periode.ts`
- Create: `src/routes/administrasi/periode.ts`
- Create: `tests/db/rute-periode.test.ts`
- Modify: `src/app.ts`

**Interfaces:**

- Produce:

```ts
export type TahunAjaranBaru = Readonly<{
  nama: string;
  tglMulai: string;
  tglSelesai: string;
}>;
export type TahunAjaranRingkas = TahunAjaranBaru & Readonly<{ id: string; aktif: boolean }>;
export type PeriodeBaru = Readonly<{
  semester: "ganjil" | "genap";
  tglMulai: string;
  tglSelesai: string;
}>;
export type PeriodeDibuat = PeriodeBaru &
  Readonly<{ id: string; tahunAjaranRef: string; aktif: boolean }>;
export type PeriodeDalamTahun = PeriodeBaru & Readonly<{ id: string; aktif: boolean }>;
export type TahunAjaranDenganPeriode = TahunAjaranRingkas &
  Readonly<{ periode: readonly PeriodeDalamTahun[] }>;

export function buatTahunAjaran(
  db: BasisData,
  input: TahunAjaranBaru,
): Promise<HasilAdministrasi<TahunAjaranRingkas>>;
export function daftarTahunAjaran(db: BasisData): Promise<readonly TahunAjaranDenganPeriode[]>;
export function buatPeriode(
  db: BasisData,
  tahunAjaranRef: string,
  input: PeriodeBaru,
): Promise<HasilAdministrasi<PeriodeDibuat>>;
export function aktifkanPeriode(
  db: BasisData,
  periodeRef: string,
): Promise<HasilAdministrasi<null>>;
export function rutaPeriode(deps: Pick<DependensiApp, "pool" | "db">): Router;
```

- [ ] **Step 1: Write failing tests**

Test 401 tanpa sesi dan 403 untuk Guru/Siswa pada seluruh endpoint, body `.strict()`, ISO calendar dates, `tgl_selesai > tgl_mulai`, duplicate year/semester 409, missing IDs 404, exact 201/GET nested shapes and sorting from API §5.4, I-03 activation rollback, serta dua request bersamaan yang mengaktifkan target berbeda pada tahun yang sama: keduanya selesai 204 secara serial dan tepat satu periode aktif pada akhirnya. Untuk rollback, nonaktifkan sibling lalu paksa update target gagal dengan `pasangPemicuGagalAktivasiPeriode(targetRef)` dan buktikan sibling tetap aktif setelah rollback. Jangan menambah aturan periode harus berada dalam rentang tanggal tahun ajaran karena kontrak sumber tidak menetapkannya.

```ts
it("menonaktifkan sibling dan mengaktifkan target dalam satu transaksi", async () => {
  const jawab = await panggilAdmin(`/api/periode/${genap}/aktif`, { metode: "PATCH" });
  expect(jawab.status).toBe(204);
  expect(await statusPeriode(tahun)).toEqual([
    { id: ganjil, aktif: false },
    { id: genap, aktif: true },
  ]);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:db -- tests/db/rute-periode.test.ts`

Expected: endpoint menjawab 404.

- [ ] **Step 3: Implement minimal routes and transaction**

Aktivasi memuat target, lalu mengunci baris induk `tahun_ajaran` dengan `FOR UPDATE` sebelum menonaktifkan sibling dan mengaktifkan target. Kunci induk yang sama menyerialkan dua request atas dua target berbeda; unique index I-03 tetap penjaga terakhir. GET mengembalikan seluruh tahun beserta periode dengan bentuk dan urutan API §5.4; tidak ada paginasi.

- [ ] **Step 4: Verify GREEN, gates, and commit**

```bash
npm run test:db -- tests/db/rute-periode.test.ts
npm run periksa
npm run lint:migrations
npm run test:db
git add src/db/administrasi/periode.ts src/routes/administrasi/periode.ts src/app.ts tests/db/rute-periode.test.ts
git commit -m "feat: kelola periode akademik atomik (AC-01)"
```

Sebelum commit, review code, TypeScript, database, dan silent failure; selesaikan semua CRITICAL/HIGH.

---

### Task 6: Mata pelajaran, KKM, dan komponen penilaian

**Files:**

- Create: `src/db/administrasi/mapel.ts`
- Create: `src/db/administrasi/komponen.ts`
- Create: `src/routes/administrasi/mapel.ts`
- Create: `src/routes/administrasi/komponen.ts`
- Create: `tests/db/rute-mapel-komponen.test.ts`
- Modify: `src/app.ts`

**Interfaces:**

- Produce:

```ts
export type Tingkat = "X" | "XI" | "XII";
export type MapelBaru = Readonly<{
  kode: string;
  nama: string;
  tingkat: Tingkat;
  kkm?: number;
  guruRef: string;
}>;
export type PerubahanMapel = Readonly<{ nama?: string; kkm?: number }>;
export type MapelDenganGuru = Readonly<{
  id: string;
  kode: string;
  nama: string;
  tingkat: Tingkat;
  kkm: number;
  guru: Readonly<{ id: string; nama: string; namaPengguna: string }>;
}>;
export type KomponenMasukan = Readonly<{
  kode: string;
  nama: string;
  bobot: number;
  urutan: number;
}>;
export type KomponenRingkas = KomponenMasukan & Readonly<{ id: string }>;

export function buatMapel(
  db: BasisData,
  input: MapelBaru,
): Promise<HasilAdministrasi<MapelDenganGuru>>;
export function daftarMapel(db: BasisData): Promise<readonly MapelDenganGuru[]>;
export function ubahMapel(
  db: BasisData,
  mapelRef: string,
  input: PerubahanMapel,
): Promise<HasilAdministrasi<MapelDenganGuru>>;
export function daftarKomponen(db: BasisData): Promise<readonly KomponenRingkas[]>;
export function gantiKomponen(
  db: BasisData,
  input: readonly KomponenMasukan[],
): Promise<HasilAdministrasi<readonly KomponenRingkas[]>>;
export function rutaMapel(deps: Pick<DependensiApp, "pool" | "db">): Router;
export function rutaKomponen(deps: Pick<DependensiApp, "pool" | "db">): Router;
```

- [ ] **Step 1: Write failing mapel tests**

Prove 401 tanpa sesi dan 403 Guru/Siswa untuk POST/GET/PATCH mapel, KKM omitted becomes 75, KKM 0 and 100 are valid, outside range is 400, one Guru cannot own two mapel (`GURU_SUDAH_MENGAMPU`), duplicate code is `DATA_SUDAH_ADA`, missing Guru/mapel 404, PATCH accepts only `nama` and `kkm`, serta exact shape/sorting API §5.5.

- [ ] **Step 2: Write failing component tests**

Prove GET is available to every authenticated role and 401 tanpa sesi; PUT is admin-only; total 98 returns exact AC-04 text; duplicate code/order is 400; before any assignment the code set may change; after any `penugasan_komponen` exists names/weights/order can change **in place while retaining every component ID**, but adding/removing/renaming codes returns 409 `KOMPONEN_SUDAH_DIPAKAI`; every failed PUT leaves the old template intact; success returns exact sorted shape API §5.6.

```ts
it("menolak total 98 dan menyebut total saat ini", async () => {
  const jawab = await gantiKomponenDenganTotal(98);
  expect(jawab.status).toBe(400);
  expect(jawab.badan.kesalahan).toEqual({
    kode: "BOBOT_TIDAK_SERATUS",
    pesan: "Jumlah bobot komponen penilaian harus tepat 100%, saat ini 98%.",
  });
});
```

- [ ] **Step 3: Verify RED**

Run: `npm run test:db -- tests/db/rute-mapel-komponen.test.ts`

Expected: endpoint menjawab 404.

- [ ] **Step 4: Implement Drizzle transactions**

Sesudah template dipakai, cocokkan himpunan kode sebelum menulis dan update baris yang sama berdasarkan `kode`; jangan delete/reinsert karena ID wajib tetap. Hindari collision `uq_komponen_urutan` ketika dua urutan ditukar dengan fase sementara yang tetap unik, lalu perbarui nilai final sebelum commit; trigger deferrable I-10 tetap penjaga terakhir.

- [ ] **Step 5: Verify GREEN, gates, and commit**

```bash
npm run test:db -- tests/db/rute-mapel-komponen.test.ts
npm run periksa
npm run lint:migrations
npm run test:db
git add src/db/administrasi/mapel.ts src/db/administrasi/komponen.ts src/routes/administrasi/mapel.ts src/routes/administrasi/komponen.ts src/app.ts tests/db/rute-mapel-komponen.test.ts
git commit -m "feat: kelola mapel KKM dan komponen (AC-01, AC-04, AC-22)"
```

Sebelum commit, review code, TypeScript, database, dan silent failure; selesaikan semua CRITICAL/HIGH.

---

### Task 7: Pratinjau kelas tanpa penulisan

**Files:**

- Create: `src/db/administrasi/pratinjau-kelas.ts`
- Create: `src/routes/administrasi/pratinjau-kelas.ts`
- Create: `tests/db/rute-pratinjau-kelas.test.ts`
- Modify: `src/app.ts`

**Interfaces:**

- Produce satu-satunya signature kanonik berikut; seluruh kegagalan repository memakai `HasilAdministrasi`.

```ts
export type PratinjauKelas = Readonly<{
  kelasBerkas: string | null;
  cocok: readonly Readonly<{
    baris: number;
    nis: string;
    namaBerkas: string;
    namaSistem: string;
    siswaRef: string;
  }>[];
  bermasalah: readonly RincianSiswaBermasalah[];
}>;

export function pratinjauKelas(
  db: BasisData,
  periodeRef: string,
  hasilUrai: HasilUrai<BarisSiswa, RincianSiswaBermasalah>,
): Promise<HasilAdministrasi<PratinjauKelas>>;

export function rutaPratinjauKelas(
  deps: Pick<DependensiApp, "pool" | "db" | "berkasAdministrasi" | "sekarang">,
): Router;
```

- [ ] **Step 1: Write failing preview tests**

Cover 401 tanpa sesi, 403 Guru/Siswa, `periode_ref` hilang/bukan UUID/tidak ada semuanya persis `400 PERMINTAAN_TIDAK_SAH`, exact match, unknown NIS, duplicate NIS, student already assigned in that period (I-08), different name as a non-failing side-by-side warning, empty/mixed `Kelas` cells producing `kelas_berkas: null` plus row problems, malformed workbook, upload limit/rate limit, and before/after table counts proving zero writes.

```ts
it("tidak menulis satu baris pun saat seluruh siswa cocok", async () => {
  const sebelum = await hitungSemuaTabelAdministrasi();
  const jawab = await pratinjau(periodeRef, workbookSah);
  expect(jawab.status).toBe(200);
  expect(await hitungSemuaTabelAdministrasi()).toEqual(sebelum);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:db -- tests/db/rute-pratinjau-kelas.test.ts`

Expected: endpoint menjawab 404.

- [ ] **Step 3: Implement one grouped read path**

Parser menghasilkan semua baris dahulu. Repository mengambil akun siswa dan keanggotaan pada `periode_ref` dalam query terkelompok, lalu membentuk larik `cocok` dan `bermasalah` terurut nomor baris. Tidak ada `insert`, `update`, `delete`, atau transaction write pada fungsi ini.

- [ ] **Step 4: Verify GREEN, security/database review, gates, and commit**

```bash
npm run test:db -- tests/db/rute-pratinjau-kelas.test.ts
npm run periksa
npm run lint:migrations
npm run test:db
git add src/db/administrasi/pratinjau-kelas.ts src/routes/administrasi/pratinjau-kelas.ts src/app.ts tests/db/rute-pratinjau-kelas.test.ts
git commit -m "feat: pratinjau kelas tanpa penulisan (AC-26)"
```

Sebelum commit, review code, TypeScript, database, security, dan silent failure; selesaikan semua CRITICAL/HIGH.

---

### Task 8: Pembuatan dan pembacaan kelas atomik

**Files:**

- Create: `src/db/administrasi/kelas.ts`
- Create: `src/routes/administrasi/kelas.ts`
- Create: `tests/db/rute-kelas.test.ts`
- Create: `tests/db/kelas-atomik.test.ts`
- Modify: `src/app.ts`

**Interfaces:**

- Produce:

```ts
export type SiswaMasukanKelas = Readonly<{
  baris: number;
  kelas: string;
  nis: string;
  namaBerkas: string;
}>;
export type PembuatanKelas = Readonly<{
  periodeRef: string;
  nama: string;
  tingkat: Tingkat;
  jurusan: string;
  guruRef: readonly string[];
  waliKelasRef: string;
  siswa: readonly SiswaMasukanKelas[];
}>;
export type KelasDibuat = Readonly<{
  id: string;
  nama: string;
  periodeRef: string;
  jumlahSiswa: number;
  jumlahPenugasan: number;
}>;
export type RingkasanKelas = Readonly<{
  id: string;
  nama: string;
  tingkat: Tingkat;
  jurusan: string;
  periode: Readonly<{ id: string; semester: "ganjil" | "genap"; tahunAjaranNama: string }>;
  waliKelas: Readonly<{ id: string; nama: string }>;
  jumlahSiswa: number;
  jumlahPenugasan: number;
}>;
export type DetailKelas = RingkasanKelas &
  Readonly<{
    siswa: readonly Readonly<{ id: string; nama: string; namaPengguna: string }>[];
    penugasan: readonly Readonly<{
      id: string;
      guru: Readonly<{ id: string; nama: string }>;
      mapel: Readonly<{
        id: string;
        kode: string;
        nama: string;
        tingkat: Tingkat;
        kkm: number;
      }>;
    }>[];
  }>;

export function buatKelasAtomik(
  db: BasisData,
  input: PembuatanKelas,
): Promise<HasilAdministrasi<KelasDibuat>>;
export function daftarKelas(db: BasisData): Promise<readonly RingkasanKelas[]>;
export function detailKelas(
  db: BasisData,
  kelasRef: string,
): Promise<HasilAdministrasi<DetailKelas>>;
export function rutaKelas(
  deps: Pick<DependensiApp, "pool" | "db" | "berkasAdministrasi" | "sekarang">,
): Router;
```

- [ ] **Step 1: Write failing request-validation tests**

Test 401 tanpa sesi dan 403 Guru/Siswa pada POST/GET/GET-detail, `.strict()` JSON multipart field `data`, unique nonempty `guru_ref`, wali inside `guru_ref`, one class value in XLSX matching `data.nama`, valid level X/XI/XII, every student matched, and no `mapel_ref` accepted from the client. `periode_ref` hilang, bukan UUID, maupun UUID yang tidak ada masing-masing wajib `400 PERMINTAAN_TIDAK_SAH`, sama seperti endpoint pratinjau.

- [ ] **Step 2: Write failing invariant and atomicity tests**

Prove Guru without mapel returns `GURU_BELUM_MENGAMPU`; mismatched level returns `JENJANG_TIDAK_COCOK` with both levels; I-08 conflict returns all bad rows; class duplicate is 409; success creates exactly one class, N memberships, one assignment per Guru, current-component-count assignment components per assignment, and one draft report per student. Untuk setiap tahap tulis (`kelas_siswa`, `penugasan`, `penugasan_komponen`, `rapor`), pasang trigger gagal dari `pasangPemicuGagal`, panggil endpoint, lepaskan trigger pada `finally`, lalu buktikan seluruh tabel kembali ke before-count. Jalankan dua request konkuren dengan siswa yang sama dan nama kelas berbeda: kunci siswa berurutan membuat satu berhasil dan satu mendapat rincian I-08, tanpa 500 atau deadlock.

```ts
it("membuat seluruh graf kelas dalam satu transaksi", async () => {
  const jawab = await buatKelas(requestSah);
  expect(jawab.status).toBe(201);
  expect(await hitungGrafKelas(jawab.badan.data.id)).toEqual({
    kelas: 1,
    siswa: 30,
    penugasan: 6,
    penugasanKomponen: 48,
    raporDraft: 30,
  });
});
```

Angka 48 pada fixture berasal dari 6 Guru × 8 komponen fixture, bukan konstanta produksi; tambahkan tes kedua dengan jumlah komponen berbeda sebelum penggunaan.

- [ ] **Step 3: Write failing list/detail tests**

`GET /api/kelas` harus mengembalikan exact ringkasan dan sorting API §5.7. `GET /api/kelas/:id` menambah siswa terurut nama dan penugasan terurut kode mapel; ID tidak ada menjawab 404. Assert query count tetap terikat (bukan satu query per siswa/guru) dan tidak ada hash kata sandi.

- [ ] **Step 4: Write failing shared-quota and AC-02/03/28 tests**

Sebelum implementasi, gunakan satu sesi Administrator untuk kombinasi unggah akun, pratinjau, dan pembuatan kelas: percobaan multipart 1–10 berbagi jatah, percobaan ke-11 pada endpoint berbeda mendapat 429. Tambahkan RED atas konteks `/api/saya`: setelah kelas terbentuk, Guru yang dipilih hanya menerima assignment miliknya; Guru lain tetap `penugasan: []`; Siswa yang belum dimasukkan tetap tidak memiliki data akademik yang sudah tersedia pada konteks A4. Jangan menambah endpoint akademik A6 untuk membuktikan hal yang belum masuk scope; literal menu frontend tetap non-scope.

- [ ] **Step 5: Verify RED**

Run: `npm run test:db -- tests/db/rute-kelas.test.ts tests/db/kelas-atomik.test.ts`

Expected: endpoint menjawab 404.

- [ ] **Step 6: Implement one Drizzle transaction plus bounded reads**

Di dalam transaksi yang sama: kunci baris siswa dalam urutan UUID stabil, ulangi validasi siswa terhadap periode, muat mapel dari setiap Guru, validasi jenjang, muat seluruh komponen saat itu, insert kelas, insert memberships, insert assignments, insert assignment-component pairs, lalu insert draft reports. `PembuatanKelas.siswa` mempertahankan `baris`, `nis`, dan `kelas` sampai repository agar konflik dapat dipetakan kembali tanpa menebak. Jangan menerima hasil pratinjau dari klien sebagai bukti karena keadaan DB dapat berubah di antaranya. Setelah rollback akibat race unique I-08, lakukan pembacaan aman untuk memetakan konflik ke rincian baris `BERKAS_TIDAK_SAH`, bukan 500.

- [ ] **Step 7: Verify GREEN, full specialist review, gates, and commit**

```bash
npm run test:db -- tests/db/rute-kelas.test.ts tests/db/kelas-atomik.test.ts
npm run periksa
npm run lint:migrations
npm run test:db
git add src/db/administrasi/kelas.ts src/routes/administrasi/kelas.ts src/app.ts tests/db/rute-kelas.test.ts tests/db/kelas-atomik.test.ts
git commit -m "feat: buat kelas penugasan dan rapor atomik (AC-01, AC-02, AC-03, AC-24, AC-26, AC-28)"
```

Review code, TypeScript, database, security, dan silent failure wajib bersih dari CRITICAL/HIGH.

---

### Task 9: Gerbang akhir, dokumentasi kemajuan, dan PR

**Files:**

- Modify: `package.json`
- Modify: `../context/KEMAJUAN.md`
- Update generated graph: `graphify-out/**` only through the Graphify update command selected by its skill.

- [ ] **Step 1: Activate the exact global threshold command**

Tambahkan script berikut setelah implementasi A5 menaikkan functions coverage:

```json
{
  "coverage:global": "npm run coverage:bersihkan && npm run coverage:unit-json && npm run coverage:db-json && tsx scripts/cakupan-global.ts --ambang=80",
  "coverage": "npm run coverage:global"
}
```

Script `periksa` yang sudah ada tetap berakhir dengan `npm run coverage`; pengalihan `coverage` di atas menjadikan ambang gabungan 80% bagian permanen dari gerbang normal A5, bukan hanya perintah final sekali jalan. Jalankan `npm run periksa` dan `npm run coverage:global`. Jika salah satu metrik di bawah 80, tambah tes perilaku nyata pada fungsi/cabang yang belum terbukti; jangan mengubah `include`, jangan mengecualikan `src`, dan jangan menurunkan ambang. Commit hijau sebagai `test: aktifkan gerbang cakupan global 80 persen pada A5` setelah review code/TypeScript/silent-failure atas perubahan harness.

- [ ] **Step 2: Run broad branch reviews**

Dispatch full-diff `code-reviewer`, `typescript-reviewer`, `database-reviewer`, mandatory `security-reviewer`, and silent-failure review in parallel. Fix every CRITICAL/HIGH with a failing regression test first, then run one scoped re-review. Setiap wave perbaikan wajib menjalankan tes scoped dan tiga gerbang, lalu di-commit sebagai satuan rollback terpisah sebelum Step 3; jangan menumpangkan perubahan kode review ke commit metadata/graph. Jika tidak ada temuan, catat eksplisit bahwa tidak ada commit perbaikan yang diperlukan.

- [ ] **Step 3: Prove the global threshold can fail and recover**

```bash
npm run coverage:gabung
npm exec tsx -- scripts/cakupan-global.ts --ambang=101
npm exec tsx -- scripts/cakupan-global.ts --ambang=80
```

Expected: `coverage:gabung` membuat dua artifact baru; ambang 101 non-zero; ambang 80 exit 0 dan setiap metrik minimal 80.

- [ ] **Step 4: Run the exact final gates**

```bash
npm run periksa
npm run lint:migrations
npm run test:db
npm run coverage:global
npm audit --omit=dev
git diff --check
```

Record exit codes, file counts, test counts, and four coverage percentages. Do not claim success from an older run.

- [ ] **Step 5: Finalize and push the backend branch**

Refresh Graphify after source is final, review `git diff`, commit tracked graph/plan metadata only if changed, rerun the exact gates after that commit, and push `fitur/a5-administrasi` with `-u`. The SHA after this push is the evidence recorded in KEMAJUAN.

- [ ] **Step 6: Update progress after backend SHA exists**

Change A5 in `../context/KEMAJUAN.md` to complete, replace the gate table with actual A5 counts, record the final pushed backend SHA and branch (no invented PR number), and remove the global-coverage debt. Do not alter PRD.md or aktor-role.md. Commit and push the Docs repository separately.

- [ ] **Step 7: Save memory and open the PR**

Save the final A5 state to Engram, then open a PR to `main` containing the AC mapping, security findings resolved, test plan, exact gate outputs, backend SHA, and Docs commits. This order follows the user's explicit requirement: KEMAJUAN → Engram → PR.

## Non-scope

- AWS, Terraform, secrets, credentials, deployment, domain names, and infrastructure Jalur B.
- A6 nilai/presensi, A7 rapor rendering/finalization/distribution, A8 AI, frontend menus, and visual UI.
- Administrator account creation through HTTP, account deactivation, student transfer, teacher reassignment, class draft/cancel endpoint, workers, queues, cron, audit-log writes, or changing the eight V1 seed values.
- New migrations or schema changes unless a new document conflict is discovered; if discovered, stop and follow docs-first.
