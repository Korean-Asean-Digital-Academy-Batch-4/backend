import { describe, expect, it } from "vitest";

import {
  KEHADIRAN_TANPA_SESI,
  STATUS_RAPOR,
  bolehDiubahGuru,
  pesanMapelBelumLengkap,
  periksaKelengkapanRapor,
  periksaTransisi,
  susunRaporMapel,
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

describe("AC-07 pesan mata pelajaran belum lengkap", () => {
  it("menyusun teksnya kata demi kata sesuai AC-07", () => {
    expect(pesanMapelBelumLengkap("Matematika")).toBe(
      "Data Mapel Matematika belum ada, tolong hubungi guru yang bertanggung jawab.",
    );
  });
});

describe("I-20 finalisasi hanya bila seluruh mata pelajaran lengkap", () => {
  it("meloloskan kelas yang seluruh mata pelajarannya lengkap", () => {
    expect(periksaKelengkapanRapor([])).toEqual({ lengkap: true });
  });

  it("menolak beserta satu rincian per mata pelajaran yang belum lengkap", () => {
    const hasil = periksaKelengkapanRapor(["Matematika", "Fisika"]);

    expect(hasil.lengkap).toBe(false);
    if (hasil.lengkap) return;
    expect(hasil.pesan).toBe(
      "Rapor belum dapat difinalisasi karena 2 mata pelajaran belum lengkap.",
    );
    expect(hasil.rincian).toEqual([
      {
        mapelNama: "Matematika",
        pesan: "Data Mapel Matematika belum ada, tolong hubungi guru yang bertanggung jawab.",
      },
      {
        mapelNama: "Fisika",
        pesan: "Data Mapel Fisika belum ada, tolong hubungi guru yang bertanggung jawab.",
      },
    ]);
  });

  it("menyebut jumlahnya apa adanya ketika hanya satu", () => {
    const hasil = periksaKelengkapanRapor(["Biologi"]);

    expect(hasil.lengkap).toBe(false);
    if (hasil.lengkap) return;
    expect(hasil.pesan).toBe(
      "Rapor belum dapat difinalisasi karena 1 mata pelajaran belum lengkap.",
    );
  });
});

describe("susunRaporMapel — salinan beku RFC-001 sec 5.5", () => {
  const komponen = [
    { kode: "TGS", nama: "Tugas", bobot: 40 },
    { kode: "UTS", nama: "Ujian Tengah Semester", bobot: 60 },
  ] as const;

  it("membekukan kode, nama, bobot, dan nilai setiap komponen", () => {
    const hasil = susunRaporMapel({
      komponen,
      nilai: [
        { kode: "TGS", nilai: 80 },
        { kode: "UTS", nilai: 90 },
      ],
      statusPresensi: ["hadir", "izin", "sakit", "alpa"],
    });

    expect(hasil.sah).toBe(true);
    if (!hasil.sah) return;
    expect(hasil.baris.snapshotKomponen).toEqual([
      { kode: "TGS", nama: "Tugas", bobot: 40, nilai: 80 },
      { kode: "UTS", nama: "Ujian Tengah Semester", bobot: 60, nilai: 90 },
    ]);
  });

  it("memakai rumus nilai akhir domain, bukan rumus baru", () => {
    const hasil = susunRaporMapel({
      komponen,
      nilai: [
        { kode: "TGS", nilai: 80 },
        { kode: "UTS", nilai: 90 },
      ],
      statusPresensi: ["hadir"],
    });

    expect(hasil.sah).toBe(true);
    if (!hasil.sah) return;
    expect(hasil.baris.nilaiAkhir).toBe(86);
  });

  it("menghitung kehadiran dengan Izin dan Sakit terhitung hadir — I-17", () => {
    const hasil = susunRaporMapel({
      komponen,
      nilai: [
        { kode: "TGS", nilai: 80 },
        { kode: "UTS", nilai: 90 },
      ],
      statusPresensi: ["hadir", "izin", "sakit", "alpa"],
    });

    expect(hasil.sah).toBe(true);
    if (!hasil.sah) return;
    expect(hasil.baris.kehadiranPersen).toBe(75);
  });

  it("menyatakan kehadiran penuh ketika belum ada satu pun sesi dibuka", () => {
    const hasil = susunRaporMapel({
      komponen,
      nilai: [
        { kode: "TGS", nilai: 80 },
        { kode: "UTS", nilai: 90 },
      ],
      statusPresensi: [],
    });

    expect(hasil.sah).toBe(true);
    if (!hasil.sah) return;
    expect(hasil.baris.kehadiranPersen).toBe(KEHADIRAN_TANPA_SESI);
  });

  it("menolak membeku selama masih ada komponen yang belum bernilai — I-12", () => {
    const hasil = susunRaporMapel({
      komponen,
      nilai: [{ kode: "TGS", nilai: 80 }],
      statusPresensi: ["hadir"],
    });

    expect(hasil).toEqual({ sah: false, sebab: "komponen_belum_lengkap" });
  });

  it("menolak membeku ketika jumlah bobot bukan seratus — I-10", () => {
    const hasil = susunRaporMapel({
      komponen: [{ kode: "TGS", nama: "Tugas", bobot: 40 }],
      nilai: [{ kode: "TGS", nilai: 80 }],
      statusPresensi: ["hadir"],
    });

    expect(hasil).toEqual({ sah: false, sebab: "bobot_tidak_seratus" });
  });
});
