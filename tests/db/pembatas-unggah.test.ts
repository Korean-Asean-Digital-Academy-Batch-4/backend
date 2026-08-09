import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import { pakaiJatahUnggah } from "../../src/db/administrasi/pembatas-unggah.js";
import { buatBasisData } from "../../src/db/drizzle.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import { bersihkanDataAdministrasi } from "./fixture-administrasi.js";

const b = inject("benih");
const SEKARANG = new Date("2026-08-10T03:15:00.000Z");

beforeEach(bersihkanDataAdministrasi);
afterEach(async () => {
  await bersihkanDataAdministrasi();
  await tutupPool();
});

describe("pakaiJatahUnggah", () => {
  it("mengizinkan percobaan 1-10 dan menolak ke-11 sampai jendela berikutnya", async () => {
    const db = buatBasisData(poolPemilik());
    for (let nomor = 1; nomor <= 10; nomor += 1) {
      await expect(pakaiJatahUnggah(db, b.admin, SEKARANG)).resolves.toEqual({ boleh: true });
    }

    await expect(pakaiJatahUnggah(db, b.admin, SEKARANG)).resolves.toEqual({
      boleh: false,
      cobaLagiPada: new Date("2026-08-10T04:00:00.000Z"),
    });
    const hasil = await poolPemilik().query<{ jumlah: number }>(
      `SELECT jumlah FROM pembatas_laju WHERE kunci = $1`,
      [`unggah:${b.admin}`],
    );
    expect(hasil.rows).toEqual([{ jumlah: 10 }]);
  });

  it("mengisolasi pengguna dan pulih tepat pada jendela berikutnya", async () => {
    const db = buatBasisData(poolPemilik());
    for (let nomor = 1; nomor <= 10; nomor += 1) await pakaiJatahUnggah(db, b.admin, SEKARANG);

    await expect(pakaiJatahUnggah(db, b.guruBio, SEKARANG)).resolves.toEqual({ boleh: true });
    await expect(
      pakaiJatahUnggah(db, b.admin, new Date("2026-08-10T04:00:00.000Z")),
    ).resolves.toEqual({ boleh: true });
  });

  it("tetap atomik ketika sebelas percobaan berlangsung bersamaan", async () => {
    const db = buatBasisData(poolPemilik());
    const hasil = await Promise.all(
      Array.from({ length: 11 }, () => pakaiJatahUnggah(db, b.admin, SEKARANG)),
    );

    expect(hasil.filter((item) => item.boleh)).toHaveLength(10);
    expect(hasil.filter((item) => !item.boleh)).toHaveLength(1);
    const tersimpan = await poolPemilik().query<{ jumlah: number }>(
      `SELECT jumlah FROM pembatas_laju WHERE kunci = $1`,
      [`unggah:${b.admin}`],
    );
    expect(tersimpan.rows).toEqual([{ jumlah: 10 }]);
  });

  it("menghapus jendela lama lintas kunci ketika memakai jatah baru", async () => {
    const db = buatBasisData(poolPemilik());
    await pakaiJatahUnggah(db, b.admin, SEKARANG);
    await pakaiJatahUnggah(db, b.guruBio, SEKARANG);

    await pakaiJatahUnggah(db, b.admin, new Date("2026-08-10T04:00:00.000Z"));

    const lama = await poolPemilik().query<{ jumlah: number }>(
      `SELECT count(*)::int AS jumlah FROM pembatas_laju
       WHERE jendela_mulai < $1 AND kunci LIKE 'unggah:%'`,
      [new Date("2026-08-10T04:00:00.000Z")],
    );
    expect(lama.rows).toEqual([{ jumlah: 0 }]);
  });
});
