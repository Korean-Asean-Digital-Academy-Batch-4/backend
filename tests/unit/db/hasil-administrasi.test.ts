import { describe, expect, it } from "vitest";

import type { HasilAdministrasi } from "../../../src/db/administrasi/hasil.js";

describe("HasilAdministrasi", () => {
  it("mewakili berkas yang melampaui batas ukuran", () => {
    const hasil: HasilAdministrasi<null> = {
      berhasil: false,
      jenis: "berkas_terlalu_besar",
      pesan: "Berkas melampaui batas ukuran.",
    };

    if (hasil.berhasil) throw new Error("Hasil berkas terlalu besar harus gagal.");

    expect(hasil.jenis).toBe("berkas_terlalu_besar");
  });
});
