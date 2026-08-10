import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { kataSandiArgon2id } from "../../src/adapters/local/kata-sandi.js";
import type { KataSandi } from "../../src/ports/kata-sandi.js";
import type { AppUji, JawabanUji } from "./bantuan-rute.js";
import { masukSebagai, nyalakanAppUji, panggilJson } from "./bantuan-rute.js";
import { poolPemilik, tutupPool } from "./bantuan.js";
import { bersihkanDataAdministrasi } from "./fixture-administrasi.js";

const AWAL_NAMA_PENGGUNA = "990048";
const KUNCI_RACE_LOGIN_RESET = 5_040_404;
let nomorSandi = 0;
let app: AppUji;

const dasarKataSandi = kataSandiArgon2id();
const kataSandiUji: KataSandi = {
  ...dasarKataSandi,
  buatAwal: () => `AwalRace${String((nomorSandi += 1)).padStart(4, "0")}`,
};

beforeAll(async () => {
  app = await nyalakanAppUji({ kataSandi: kataSandiUji });
});
beforeEach(async () => {
  nomorSandi = 0;
  await bersihkanDataAdministrasi();
  await bersihkanRace();
});
afterEach(async () => {
  await bersihkanDataAdministrasi();
  await bersihkanRace();
});
afterAll(async () => {
  try {
    await app.tutup();
  } finally {
    await tutupPool();
  }
});

function data(jawab: JawabanUji): Record<string, unknown> {
  return (jawab.badan as { data: Record<string, unknown> }).data;
}

async function buatManual(sesi: string, nomor: string): Promise<JawabanUji> {
  return panggilJson(app, "/api/pengguna", {
    metode: "POST",
    sesi,
    badan: {
      nama: `uji-a5-task4-race-${nomor}`,
      nama_pengguna: `${AWAL_NAMA_PENGGUNA}${nomor}`,
      peran: "guru",
    },
  });
}

async function bersihkanRace(): Promise<void> {
  const pool = poolPemilik();
  await pool.query(`DROP TRIGGER IF EXISTS uji_a5_tahan_insert_sesi ON sesi_masuk`);
  await pool.query(`DROP FUNCTION IF EXISTS uji_a5_tahan_insert_sesi()`);
  await pool.query(`DELETE FROM pembatas_laju WHERE kunci LIKE $1`, [
    `login:pengguna:${AWAL_NAMA_PENGGUNA}%`,
  ]);
  await pool.query(
    `DELETE FROM sesi_masuk WHERE pengguna_ref IN
       (SELECT id FROM pengguna WHERE nama_pengguna LIKE $1)`,
    [`${AWAL_NAMA_PENGGUNA}%`],
  );
  await pool.query(
    `DELETE FROM guru WHERE pengguna_ref IN
       (SELECT id FROM pengguna WHERE nama_pengguna LIKE $1)`,
    [`${AWAL_NAMA_PENGGUNA}%`],
  );
  await pool.query(`DELETE FROM pengguna WHERE nama_pengguna LIKE $1`, [`${AWAL_NAMA_PENGGUNA}%`]);
}

async function tungguKueriTerblokir(pola: string): Promise<void> {
  for (let percobaan = 0; percobaan < 100; percobaan += 1) {
    const hasil = await poolPemilik().query<{ ada: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND query ILIKE $1
       ) AS ada`,
      [pola],
    );
    if (hasil.rows[0]?.ada) return;
    await new Promise((selesai) => setTimeout(selesai, 5));
  }
  throw new Error(`Kueri uji tidak mencapai barrier lock: ${pola}`);
}

async function pasangPenghalangInsertSesi(): Promise<{
  readonly buka: () => Promise<void>;
  readonly lepas: () => Promise<void>;
}> {
  const pool = poolPemilik();
  const pengunci = await pool.connect();
  await pool.query(`
    CREATE OR REPLACE FUNCTION uji_a5_tahan_insert_sesi() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(${KUNCI_RACE_LOGIN_RESET});
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER uji_a5_tahan_insert_sesi
      BEFORE INSERT ON sesi_masuk
      FOR EACH ROW EXECUTE FUNCTION uji_a5_tahan_insert_sesi();
  `);
  await pengunci.query(`SELECT pg_advisory_lock($1)`, [KUNCI_RACE_LOGIN_RESET]);

  let terbuka = false;
  const buka = async (): Promise<void> => {
    if (terbuka) return;
    terbuka = true;
    await pengunci.query(`SELECT pg_advisory_unlock($1)`, [KUNCI_RACE_LOGIN_RESET]);
  };
  return {
    buka,
    lepas: async () => {
      await buka().catch(() => undefined);
      pengunci.release();
      await pool.query(`DROP TRIGGER IF EXISTS uji_a5_tahan_insert_sesi ON sesi_masuk`);
      await pool.query(`DROP FUNCTION IF EXISTS uji_a5_tahan_insert_sesi()`);
    },
  };
}

describe("serialisasi login dan reset kata sandi Administrator", () => {
  it("menolak login hash lama yang selesai setelah reset dan mempertahankan penghitung", async () => {
    const admin = await masukSebagai(app, "admin");
    const dibuat = await buatManual(admin, "01");
    const id = String(data(dibuat).id);
    const lama = String(data(dibuat).kata_sandi_awal);
    const gagalAwal = await panggilJson(app, "/api/auth/masuk", {
      metode: "POST",
      badan: { nama_pengguna: "99004801", kata_sandi: "salah-sebelum-race" },
    });
    expect(gagalAwal.status).toBe(401);

    let tandaiVerifikasi!: () => void;
    let lanjutkan!: () => void;
    const verifikasiSelesai = new Promise<void>((selesai) => {
      tandaiVerifikasi = selesai;
    });
    const bolehLanjut = new Promise<void>((selesai) => {
      lanjutkan = selesai;
    });
    const kataSandiRace: KataSandi = {
      ...dasarKataSandi,
      verifikasi: async (hash, polos) => {
        const cocok = await dasarKataSandi.verifikasi(hash, polos);
        if (polos === lama && cocok) {
          tandaiVerifikasi();
          await bolehLanjut;
        }
        return cocok;
      },
    };
    const appRace = await nyalakanAppUji({ kataSandi: kataSandiRace });
    try {
      const login = panggilJson(appRace, "/api/auth/masuk", {
        metode: "POST",
        badan: { nama_pengguna: "99004801", kata_sandi: lama },
      });
      await verifikasiSelesai;

      const reset = await panggilJson(app, `/api/pengguna/${id}/kata-sandi`, {
        metode: "POST",
        sesi: admin,
      });
      expect(reset.status).toBe(200);
      lanjutkan();

      const jawabLogin = await login;
      expect(jawabLogin.status).toBe(401);
      expect(jawabLogin.badan).toMatchObject({ kesalahan: { kode: "KREDENSIAL_SALAH" } });
      const keadaan = await poolPemilik().query<{ sesi: number; batas: number }>(
        `SELECT
           (SELECT count(*)::int FROM sesi_masuk WHERE pengguna_ref = $1) AS sesi,
           (SELECT coalesce(sum(jumlah), 0)::int FROM pembatas_laju WHERE kunci = $2) AS batas`,
        [id, "login:pengguna:99004801"],
      );
      expect(keadaan.rows).toEqual([{ sesi: 0, batas: 2 }]);
    } finally {
      lanjutkan();
      await appRace.tutup();
    }
  });

  it("menghapus sesi ketika login menang lock sebelum reset menunggu", async () => {
    const admin = await masukSebagai(app, "admin");
    const dibuat = await buatManual(admin, "02");
    const id = String(data(dibuat).id);
    const lama = String(data(dibuat).kata_sandi_awal);
    const penghalang = await pasangPenghalangInsertSesi();
    let login: Promise<JawabanUji> | undefined;
    let reset: Promise<JawabanUji> | undefined;

    try {
      login = panggilJson(app, "/api/auth/masuk", {
        metode: "POST",
        badan: { nama_pengguna: "99004802", kata_sandi: lama },
      });
      await tungguKueriTerblokir('%insert into "sesi_masuk"%');

      reset = panggilJson(app, `/api/pengguna/${id}/kata-sandi`, {
        metode: "POST",
        sesi: admin,
      });
      await tungguKueriTerblokir('%update "pengguna"%');
      await penghalang.buka();

      const [jawabLogin, jawabReset] = await Promise.all([login, reset]);
      expect(jawabLogin.status).toBe(200);
      expect(jawabReset.status).toBe(200);
      const sesi = await poolPemilik().query<{ jumlah: number }>(
        `SELECT count(*)::int AS jumlah FROM sesi_masuk WHERE pengguna_ref = $1`,
        [id],
      );
      expect(sesi.rows).toEqual([{ jumlah: 0 }]);
    } finally {
      await penghalang.buka().catch(() => undefined);
      await Promise.all([login?.catch(() => undefined), reset?.catch(() => undefined)]);
      await penghalang.lepas();
    }
  });
});
