/**
 * Alamat klien untuk kunci pembatas laju — CK-A-08.
 *
 * Diambil dari entri **TERAKHIR** `X-Forwarded-For`, bukan yang pertama.
 * CloudFront dan Caddy sama-sama *menambahkan* alamat yang mereka lihat di
 * ujung daftar, sehingga entri terakhir berasal dari proksi tepercaya dan tidak
 * dapat dipalsukan klien. Entri pertama justru sepenuhnya dikuasai klien;
 * memakainya menghasilkan pembatas laju yang dapat dilewati hanya dengan
 * mengarang satu header — keadaan yang lebih buruk daripada tidak ada pembatas
 * sama sekali, karena ia tampak melindungi.
 *
 * Tidak memakai `app.set("trust proxy", n)` karena jumlah lompatan berbeda
 * antara AWS dan on-prem, dan salah menghitungnya menghasilkan pembacaan alamat
 * yang keliru tanpa gejala apa pun.
 */
export function alamatKlien(
  headerXff: string | undefined,
  alamatSoket: string | undefined,
): string {
  const bagian = (headerXff ?? "")
    .split(",")
    .map((satu) => satu.trim())
    .filter((satu) => satu.length > 0);

  return bagian[bagian.length - 1] ?? alamatSoket ?? "tidak-diketahui";
}
