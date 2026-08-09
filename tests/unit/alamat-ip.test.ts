import { describe, expect, it } from "vitest";

import { alamatKlien } from "../../src/routes/alamat-ip.js";

// CK-A-08: alamat diambil dari entri TERAKHIR X-Forwarded-For. CloudFront dan
// Caddy sama-sama menambahkan alamat yang mereka lihat di ujung daftar, sehingga
// entri terakhir berasal dari proksi tepercaya. Entri pertama dikuasai klien.

describe("alamatKlien", () => {
  it("memakai alamat soket ketika tidak ada X-Forwarded-For", () => {
    expect(alamatKlien(undefined, "203.0.113.7")).toBe("203.0.113.7");
  });

  it("memakai satu-satunya entri ketika daftarnya tunggal", () => {
    expect(alamatKlien("203.0.113.7", "10.0.0.1")).toBe("203.0.113.7");
  });

  it("memakai entri TERAKHIR, bukan yang pertama", () => {
    expect(alamatKlien("198.51.100.9, 203.0.113.7", "10.0.0.1")).toBe("203.0.113.7");
  });

  it("mengabaikan entri palsu yang disisipkan klien di depan", () => {
    const dipalsukan = alamatKlien("1.1.1.1, 2.2.2.2, 203.0.113.7", "10.0.0.1");
    const jujur = alamatKlien("203.0.113.7", "10.0.0.1");

    expect(dipalsukan).toBe(jujur);
  });

  it("tahan terhadap spasi dan entri kosong", () => {
    expect(alamatKlien("  198.51.100.9 ,  203.0.113.7  ,, ", "10.0.0.1")).toBe("203.0.113.7");
  });

  it("jatuh ke alamat soket ketika headernya kosong atau hanya koma", () => {
    expect(alamatKlien("", "10.0.0.1")).toBe("10.0.0.1");
    expect(alamatKlien(",,", "10.0.0.1")).toBe("10.0.0.1");
  });

  it("menghasilkan penanda tetap ketika keduanya tidak tersedia", () => {
    expect(alamatKlien(undefined, undefined)).toBe("tidak-diketahui");
  });
});
