// Data benih bagi uji penegakan basis data. Pengenalnya dipatok, bukan
// dibangkitkan, sehingga setiap tes menyebut baris yang sama tanpa saling
// mewariskan keadaan.

export const BENIH = {
  admin: "00000000-0000-4000-8000-000000000001",
  guruBio: "00000000-0000-4000-8000-000000000011",
  guruFis: "00000000-0000-4000-8000-000000000012",
  guruTanpaMapel: "00000000-0000-4000-8000-000000000013",
  siswaAndi: "00000000-0000-4000-8000-000000000021",
  siswaBudi: "00000000-0000-4000-8000-000000000022",
  tahunAjaran: "00000000-0000-4000-8000-000000000031",
  periodeGanjil: "00000000-0000-4000-8000-000000000041",
  periodeGenap: "00000000-0000-4000-8000-000000000042",
  kelasX1: "00000000-0000-4000-8000-000000000051",
  kelasXi1: "00000000-0000-4000-8000-000000000052",
  mapelBio: "00000000-0000-4000-8000-000000000061",
  mapelFis: "00000000-0000-4000-8000-000000000062",
  penugasanBioX1: "00000000-0000-4000-8000-000000000071",
} as const;

// Satu pernyataan, satu transaksi implisit. Jenjang seluruh benih sengaja
// dibuat bercampur — Biologi di jenjang X dan Fisika di jenjang XI — supaya
// penolakan I-06 dapat diuji tanpa menyiapkan apa pun lagi.
export function pernyataanBenih(): string {
  const b = BENIH;

  return `
INSERT INTO pengguna (id, nama_pengguna, nama, peran, kata_sandi_hash) VALUES
  ('${b.admin}',          'admin',        'Administrator', 'administrator', 'x'),
  ('${b.guruBio}',        '198001011001', 'Guru Biologi',  'guru',          'x'),
  ('${b.guruFis}',        '198001011002', 'Guru Fisika',   'guru',          'x'),
  ('${b.guruTanpaMapel}', '198001011003', 'Guru Cadangan', 'guru',          'x'),
  ('${b.siswaAndi}',      '2026001',      'Andi',          'siswa',         'x'),
  ('${b.siswaBudi}',      '2026002',      'Budi',          'siswa',         'x');

INSERT INTO guru (pengguna_ref) VALUES
  ('${b.guruBio}'), ('${b.guruFis}'), ('${b.guruTanpaMapel}');

INSERT INTO siswa (pengguna_ref) VALUES
  ('${b.siswaAndi}'), ('${b.siswaBudi}');

INSERT INTO tahun_ajaran (id, nama, tgl_mulai, tgl_selesai, aktif) VALUES
  ('${b.tahunAjaran}', '2026/2027', '2026-07-01', '2027-06-30', true);

INSERT INTO periode (id, tahun_ajaran_ref, semester, tgl_mulai, tgl_selesai, aktif) VALUES
  ('${b.periodeGanjil}', '${b.tahunAjaran}', 'ganjil', '2026-07-01', '2026-12-31', true),
  ('${b.periodeGenap}',  '${b.tahunAjaran}', 'genap',  '2027-01-01', '2027-06-30', false);

INSERT INTO kelas (id, periode_ref, nama, tingkat, wali_kelas_ref) VALUES
  ('${b.kelasX1}',  '${b.periodeGanjil}', 'X-1',  'X',  '${b.guruBio}'),
  ('${b.kelasXi1}', '${b.periodeGanjil}', 'XI-1', 'XI', NULL);

INSERT INTO kelas_siswa (kelas_ref, siswa_ref, periode_ref) VALUES
  ('${b.kelasX1}', '${b.siswaAndi}', '${b.periodeGanjil}');

INSERT INTO mapel (id, kode, nama, tingkat, guru_ref) VALUES
  ('${b.mapelBio}', 'BIO', 'Biologi', 'X',  '${b.guruBio}'),
  ('${b.mapelFis}', 'FIS', 'Fisika',  'XI', '${b.guruFis}');

INSERT INTO penugasan (id, guru_ref, mapel_ref, kelas_ref, tingkat) VALUES
  ('${b.penugasanBioX1}', '${b.guruBio}', '${b.mapelBio}', '${b.kelasX1}', 'X');
`;
}
