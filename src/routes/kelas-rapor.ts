import { Router, type Response } from "express";
import { z } from "zod";

import type { DependensiApp } from "../dependensi-app.js";
import { adalahWaliKelas } from "../db/rapor/akses.js";
import { renderSekelas, susunArsipKelas, type DependensiBerkas } from "../db/rapor/berkas.js";
import { distribusiKelas } from "../db/rapor/distribusi.js";
import { finalisasiKelas } from "../db/rapor/finalisasi.js";
import { bacaKesiapanKelas, cariKonteksKelas, daftarRaporKelas } from "../db/rapor/kesiapan.js";
import { UMUR_TAUTAN_DETIK } from "../ports/penyimpanan-berkas.js";
import { ANGGARAN_RENDER_MS } from "../ports/rapor-berkas.js";
import type { Penuntut } from "./middleware-sesi.js";
import { KODE, kirimData, kirimKesalahan } from "./amplop.js";
import { bungkus } from "./bungkus.js";
import { wajibMasuk } from "./middleware-sesi.js";

/**
 * Rute rapor tingkat kelas — [API.md §8.1], §8.3, §8.4, dan §8.5.
 *
 * Seluruhnya **Administrator dan Wali Kelas saja**. Guru Mata Pelajaran tidak
 * memiliki jalur finalisasi (AC-08) maupun jalur unduh (AC-32) dalam bentuk apa
 * pun, dan Siswa hanya mengenal rapornya sendiri lewat `rutaRapor`.
 */

const uuidSkema = z.string().uuid();

/** Awalan arsip sekelas. Dihapus aturan daur hidup S3 — [API.md §8.5]. */
const AWALAN_SEMENTARA = "sementara";

export function rutaKelasRapor(deps: DependensiApp): Router {
  const ruta = Router();
  const harusMasuk = wajibMasuk(deps.pool);
  const depsBerkas: DependensiBerkas = {
    db: deps.db,
    penyimpanan: deps.penyimpanan,
    raporBerkas: deps.raporBerkas,
    sekarang: deps.sekarang,
  };

  /**
   * Lapis peran dan lapis baris kelas dalam satu tempat.
   *
   * Guru yang bukan wali kelas ditolak oleh cabang yang sama seperti guru yang
   * sama sekali tidak mengajar di kelas itu — tidak ada aturan khusus bagi Guru
   * Mata Pelajaran, sesuai [ARCHITECTURE.md §9.2].
   */
  async function bolehAtasKelas(
    res: Response,
    penuntut: Penuntut,
    kelasRef: string,
  ): Promise<boolean> {
    if (penuntut.peran === "administrator") return true;
    if (penuntut.peran !== "guru") {
      kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda tidak berwenang atas rapor kelas.");
      return false;
    }
    if (!(await adalahWaliKelas(deps.db, kelasRef, penuntut.penggunaRef))) {
      kirimKesalahan(res, 403, KODE.kewenanganDitolak, "Anda bukan Wali Kelas kelas ini.");
      return false;
    }
    return true;
  }

  ruta.get(
    "/api/kelas/:id/rapor",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal kelas tidak sah.");
        return;
      }
      if (!(await bolehAtasKelas(res, req.penuntut!, id.data))) return;

      const kesiapan = await bacaKesiapanKelas(deps.db, id.data);
      if (!kesiapan) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, "Kelas tidak ditemukan.");
        return;
      }

      kirimData(res, 200, {
        kelas: {
          id: kesiapan.konteks.id,
          nama: kesiapan.konteks.nama,
          periode_nama: kesiapan.konteks.periodeNama,
        },
        status: kesiapan.status,
        kelengkapan: kesiapan.kelengkapan.map((satu) => ({
          mapel_nama: satu.mapelNama,
          lengkap: satu.lengkap,
          nilai_terisi: satu.nilaiTerisi,
          nilai_diperlukan: satu.nilaiDiperlukan,
        })),
        rapor: kesiapan.rapor.map((satu) => ({
          id: satu.id,
          siswa_ref: satu.siswaRef,
          siswa_nama: satu.siswaNama,
          catatan_wali: satu.catatanWali,
          status: satu.status,
        })),
      });
    }),
  );

  ruta.post(
    "/api/kelas/:id/rapor/finalisasi",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal kelas tidak sah.");
        return;
      }
      const penuntut = req.penuntut!;
      if (!(await bolehAtasKelas(res, penuntut, id.data))) return;

      const konteks = await cariKonteksKelas(deps.db, id.data);
      if (!konteks) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, "Kelas tidak ditemukan.");
        return;
      }

      const hasil = await finalisasiKelas(deps.db, {
        kelasRef: id.data,
        difinalisasiOleh: penuntut.penggunaRef,
        sekarang: deps.sekarang,
      });
      if (!hasil.berhasil) {
        if (hasil.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        } else if (hasil.jenis === "mapel_belum_lengkap") {
          kirimKesalahan(
            res,
            409,
            KODE.mapelBelumLengkap,
            hasil.pesan,
            hasil.rincian?.map((satu) => ({ mapel_nama: satu.mapelNama, pesan: satu.pesan })),
          );
        } else if (hasil.jenis === "sudah_final") {
          kirimKesalahan(res, 409, KODE.raporTerkunci, hasil.pesan);
        } else {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        }
        return;
      }

      // Sesudah COMMIT, di dalam request yang sama, dengan anggaran lunak
      // 20 detik — CK-API-12. Kegagalannya tidak pernah membatalkan finalisasi.
      const render = await renderSekelas(
        depsBerkas,
        hasil.data.raporRef,
        konteks.periodeRef,
        ANGGARAN_RENDER_MS,
      );

      kirimData(res, 200, {
        difinalisasi: hasil.data.difinalisasi,
        difinalisasi_pada: hasil.data.difinalisasiPada.toISOString(),
        berkas_terender: render.terender,
      });
    }),
  );

  ruta.post(
    "/api/kelas/:id/rapor/distribusi",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal kelas tidak sah.");
        return;
      }
      if (!(await bolehAtasKelas(res, req.penuntut!, id.data))) return;

      const hasil = await distribusiKelas(deps.db, {
        kelasRef: id.data,
        sekarang: deps.sekarang,
      });
      if (!hasil.berhasil) {
        if (hasil.jenis === "tidak_ditemukan") {
          kirimKesalahan(res, 404, KODE.tidakDitemukan, hasil.pesan);
        } else if (hasil.jenis === "belum_final") {
          kirimKesalahan(res, 409, KODE.raporTerkunci, hasil.pesan);
        } else {
          kirimKesalahan(res, 400, KODE.permintaanTidakSah, hasil.pesan);
        }
        return;
      }

      kirimData(res, 200, {
        didistribusikan: hasil.data.didistribusikan,
        didistribusikan_pada: hasil.data.didistribusikanPada.toISOString(),
      });
    }),
  );

  ruta.get(
    "/api/kelas/:id/rapor/berkas",
    harusMasuk,
    bungkus(async (req, res) => {
      const id = uuidSkema.safeParse(req.params.id);
      if (!id.success) {
        kirimKesalahan(res, 400, KODE.permintaanTidakSah, "Pengenal kelas tidak sah.");
        return;
      }
      if (!(await bolehAtasKelas(res, req.penuntut!, id.data))) return;

      const konteks = await cariKonteksKelas(deps.db, id.data);
      if (!konteks) {
        kirimKesalahan(res, 404, KODE.tidakDitemukan, "Kelas tidak ditemukan.");
        return;
      }
      const daftar = await daftarRaporKelas(deps.db, id.data, konteks.periodeRef);
      const belumFinal = daftar.filter((satu) => satu.status === "draft");
      if (daftar.length === 0 || belumFinal.length > 0) {
        kirimKesalahan(
          res,
          409,
          KODE.berkasBelumSiap,
          "Rapor kelas ini belum difinalisasi, sehingga arsipnya belum dapat diunduh.",
        );
        return;
      }

      // Rapor yang berkasnya belum ada dirender lebih dahulu, dengan anggaran
      // lunak yang sama seperti §8.3. Yang sudah jadi tetap tersimpan, sehingga
      // permintaan berikutnya melanjutkan dari sana — bukan mengulang.
      const render = await renderSekelas(
        depsBerkas,
        daftar.map((satu) => satu.id),
        konteks.periodeRef,
        ANGGARAN_RENDER_MS,
      );
      if (render.tersisa.length > 0) {
        kirimKesalahan(
          res,
          409,
          KODE.berkasBelumSiap,
          `Sebagian berkas rapor belum selesai dirender. Silakan coba lagi; ${render.terender} dari ${daftar.length} berkas sudah siap.`,
          [{ siap: render.terender, jumlah_rapor: daftar.length }],
        );
        return;
      }

      const arsip = await susunArsipKelas(
        depsBerkas,
        daftar.map((satu) => ({ raporRef: satu.id, siswaNama: satu.siswaNama })),
        konteks.periodeRef,
      );
      // Arsip TIDAK pernah dipakai ulang: ia dibangun ulang setiap permintaan
      // dan disimpan di bawah awalan `sementara/` — [API.md §8.5]. Dengan begitu
      // ia tidak dapat menjadi usang setelah Administrator mengoreksi data final.
      const kunci = `${AWALAN_SEMENTARA}/${konteks.periodeRef}/${id.data}-${deps.sekarang().getTime()}.zip`;
      await deps.penyimpanan.simpan(kunci, arsip, "application/zip");

      const tautan = await deps.penyimpanan.tautan(kunci, UMUR_TAUTAN_DETIK);
      kirimData(res, 200, {
        url: tautan.url,
        kedaluwarsa_pada: tautan.kedaluwarsaPada.toISOString(),
        jumlah_rapor: daftar.length,
      });
    }),
  );

  return ruta;
}
