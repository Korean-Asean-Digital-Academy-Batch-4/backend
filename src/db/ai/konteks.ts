import type { Pool } from "pg";

import { hitungNilaiAkhir } from "../../domain/nilai.js";
import { hitungPersentaseKehadiran, type StatusPresensi } from "../../domain/presensi.js";
import type { KomponenKonteks, KonteksSaran, MapelKonteks } from "../../ports/ai-advisor.js";

/**
 * Bahan prompt tombol Suggestion — [ARCHITECTURE.md Pasal 10], AC-17.
 *
 * **Dibaca lewat koneksi `app_ro`**, yang tidak memiliki hak tulis dan tidak
 * memiliki hak baca atas `pengguna`, `guru`, maupun `siswa` ([SCHEMA.md §7.1]).
 * Karena itu berkas ini **tidak dapat** memperoleh nama maupun NIS sekalipun
 * kuerinya ditulis keliru — PostgreSQL yang menolak, bukan disiplin penulisnya.
 *
 * Pembatasan gandanya: klausa `WHERE` pada siswa yang menekan tombol, **dan**
 * role yang tidak dapat menulis (I-23, AC-20).
 *
 * Perhitungan nilai akhir dan persentase kehadiran dikerjakan `domain/`, bukan
 * oleh AI ([PRD §8.6] butir 1).
 */

type BarisNilai = Readonly<{
  mapel_nama: string;
  kkm: number;
  kode: string;
  komponen_nama: string;
  bobot: number;
  topik: string | null;
  nilai: string | null;
}>;

type BarisPresensi = Readonly<{ mapel_nama: string; status: string }>;

export type HasilKonteks =
  | Readonly<{ ada: true; konteks: KonteksSaran }>
  | Readonly<{ ada: false; sebab: "tanpa_kelas" | "tanpa_nilai"; periodeNama: string | null }>;

/**
 * Menyusun konteks satu siswa pada semester berjalan.
 *
 * `ada: false` beserta `sebab: "tanpa_nilai"` adalah keadaan yang dijawab
 * pemanggil tanpa memanggil AI sama sekali — CK-API-19.
 */
export async function bacaKonteksSiswa(poolRo: Pool, siswaRef: string): Promise<HasilKonteks> {
  const periode = await poolRo.query<{ periode_nama: string; kelas_ref: string }>(
    `SELECT ta.nama || ' ' || CASE p.semester WHEN 'ganjil' THEN 'Ganjil' ELSE 'Genap' END
             AS periode_nama,
           ks.kelas_ref
     FROM kelas_siswa ks
     JOIN kelas k         ON k.id = ks.kelas_ref
     JOIN periode p       ON p.id = k.periode_ref
     JOIN tahun_ajaran ta ON ta.id = p.tahun_ajaran_ref
     WHERE ks.siswa_ref = $1 AND p.aktif = true
     ORDER BY p.tgl_mulai DESC, p.id DESC, k.id DESC
     LIMIT 1`,
    [siswaRef],
  );

  const barisPeriode = periode.rows[0];
  if (!barisPeriode) {
    return { ada: false, sebab: "tanpa_kelas", periodeNama: null };
  }

  const nilai = await poolRo.query<BarisNilai>(
    `SELECT m.nama          AS mapel_nama,
            m.kkm           AS kkm,
            kp.kode         AS kode,
            kp.nama         AS komponen_nama,
            kp.bobot        AS bobot,
            pk.topik        AS topik,
            n.nilai         AS nilai
     FROM penugasan pg
     JOIN mapel m               ON m.id = pg.mapel_ref
     JOIN penugasan_komponen pk ON pk.penugasan_ref = pg.id
     JOIN komponen_penilaian kp ON kp.id = pk.komponen_ref
     LEFT JOIN nilai n
            ON n.penugasan_ref = pg.id
           AND n.komponen_ref  = kp.id
           AND n.siswa_ref     = $2
     WHERE pg.kelas_ref = $1
     ORDER BY m.kode, kp.urutan`,
    [barisPeriode.kelas_ref, siswaRef],
  );

  if (nilai.rows.every((baris) => baris.nilai === null)) {
    return { ada: false, sebab: "tanpa_nilai", periodeNama: barisPeriode.periode_nama };
  }

  const presensi = await poolRo.query<BarisPresensi>(
    `SELECT m.nama AS mapel_nama, p.status AS status
     FROM presensi p
     JOIN sesi s      ON s.id = p.sesi_ref
     JOIN penugasan pg ON pg.id = s.penugasan_ref
     JOIN mapel m      ON m.id = pg.mapel_ref
     WHERE pg.kelas_ref = $1 AND p.siswa_ref = $2`,
    [barisPeriode.kelas_ref, siswaRef],
  );

  const statusPerMapel = new Map<string, StatusPresensi[]>();
  for (const baris of presensi.rows) {
    const daftar = statusPerMapel.get(baris.mapel_nama) ?? [];
    daftar.push(baris.status as StatusPresensi);
    statusPerMapel.set(baris.mapel_nama, daftar);
  }

  return {
    ada: true,
    konteks: Object.freeze({
      periodeNama: barisPeriode.periode_nama,
      mapel: susunMapel(nilai.rows, statusPerMapel),
    }),
  };
}

function susunMapel(
  baris: readonly BarisNilai[],
  statusPerMapel: ReadonlyMap<string, readonly StatusPresensi[]>,
): readonly MapelKonteks[] {
  const perMapel = new Map<string, BarisNilai[]>();
  for (const satu of baris) {
    const daftar = perMapel.get(satu.mapel_nama) ?? [];
    daftar.push(satu);
    perMapel.set(satu.mapel_nama, daftar);
  }

  const hasil: MapelKonteks[] = [];
  for (const [mapelNama, barisMapel] of perMapel) {
    const komponen: KomponenKonteks[] = barisMapel.map((satu) =>
      Object.freeze({
        kode: satu.kode,
        nama: satu.komponen_nama,
        bobot: satu.bobot,
        nilai: satu.nilai === null ? null : Number(satu.nilai),
        topik: satu.topik,
      }),
    );

    // Rumusnya tidak ditulis ulang di sini — `hitungNilaiAkhir` menolak
    // menghitung selama komponennya belum lengkap, dan itulah yang menjadikan
    // `nilaiAkhir` bernilai null pada keadaan itu ([PRD §8.6] butir 5).
    const akhir = hitungNilaiAkhir(
      komponen.map((satu) => ({ kode: satu.kode, bobot: satu.bobot })),
      komponen
        .filter((satu) => satu.nilai !== null)
        .map((satu) => ({ kode: satu.kode, nilai: satu.nilai! })),
    );

    const kehadiran = hitungPersentaseKehadiran(statusPerMapel.get(mapelNama) ?? []);

    hasil.push(
      Object.freeze({
        nama: mapelNama,
        kkm: barisMapel[0]!.kkm,
        lengkap: akhir.sah,
        nilaiAkhir: akhir.sah ? akhir.nilaiAkhir : null,
        kehadiranPersen: kehadiran.adaSesi ? kehadiran.persen : null,
        komponen: Object.freeze(komponen),
      }),
    );
  }

  return Object.freeze(hasil);
}
