import { describe, expect, it } from "vitest";

import {
  STATUS_RAPOR,
  bolehDiubahGuru,
  periksaTransisi,
  terlihatSiswa,
  urutanStatus,
  type StatusRapor,
} from "../../../src/domain/rapor.js";

// PRD sec 9 dan RFC-001 sec 5.5. Status bergerak maju draft → finalized →
// distributed, dan tidak tersedia mekanisme buka kembali.

describe("urutanStatus", () => {
  it("menempatkan ketiganya berurutan maju", () => {
    expect(urutanStatus("draft")).toBeLessThan(urutanStatus("finalized"));
    expect(urutanStatus("finalized")).toBeLessThan(urutanStatus("distributed"));
  });
});

describe("I-21 status rapor hanya bergerak maju", () => {
  it("menerima draft menjadi finalized", () => {
    expect(periksaTransisi("draft", "finalized")).toEqual({ sah: true });
  });

  it("menerima finalized menjadi distributed", () => {
    expect(periksaTransisi("finalized", "distributed")).toEqual({ sah: true });
  });

  it("menolak finalized kembali menjadi draft", () => {
    const hasil = periksaTransisi("finalized", "draft");

    expect(hasil.sah).toBe(false);
    if (hasil.sah) return;
    expect(hasil.pesan).toContain("hanya bergerak maju");
  });

  it("menolak distributed kembali menjadi finalized", () => {
    expect(periksaTransisi("distributed", "finalized").sah).toBe(false);
  });

  it("menolak distributed kembali menjadi draft", () => {
    expect(periksaTransisi("distributed", "draft").sah).toBe(false);
  });

  it("menolak lompatan draft langsung ke distributed", () => {
    const hasil = periksaTransisi("draft", "distributed");

    expect(hasil.sah).toBe(false);
    if (hasil.sah) return;
    expect(hasil.pesan).toContain("satu langkah");
  });

  it("menolak perpindahan ke status yang sama", () => {
    for (const status of STATUS_RAPOR) {
      expect(periksaTransisi(status, status).sah).toBe(false);
    }
  });
});

describe("I-22 rapor final terkunci bagi Guru dan Wali Kelas", () => {
  it("mengizinkan perubahan selama masih draft", () => {
    expect(bolehDiubahGuru("draft")).toBe(true);
  });

  it("mengunci sejak finalized — AC-14", () => {
    expect(bolehDiubahGuru("finalized")).toBe(false);
    expect(bolehDiubahGuru("distributed")).toBe(false);
  });
});

describe("keterlihatan bagi Siswa — PRD sec 9", () => {
  it("menyembunyikan rapor sampai didistribusikan", () => {
    expect(terlihatSiswa("draft")).toBe(false);
    expect(terlihatSiswa("finalized")).toBe(false);
  });

  it("menampilkannya setelah didistribusikan", () => {
    expect(terlihatSiswa("distributed")).toBe(true);
  });
});

describe("himpunan status tertutup", () => {
  it("memuat tepat tiga status sesuai ck_rapor_status", () => {
    const diharapkan: StatusRapor[] = ["draft", "finalized", "distributed"];

    expect(STATUS_RAPOR).toEqual(diharapkan);
  });
});
