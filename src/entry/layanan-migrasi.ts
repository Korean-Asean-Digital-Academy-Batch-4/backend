import { createServer, type Server, type ServerResponse } from "node:http";

/**
 * Fungsi `migrate` sebagai layanan HTTP berumur pendek — CK-D-08.
 *
 * Lambda Web Adapter menuntut aplikasi yang **mendengarkan HTTP**: ia berjalan
 * sebagai extension, mengambil alih perulangan invocation, lalu meneruskannya
 * sebagai request ke `127.0.0.1:8080`, dan tidak mengalirkan trafik sebelum
 * readiness check lulus ([ARCHITECTURE.md Pasal 6]). Perintah yang berjalan
 * sekali lalu keluar karenanya tidak dapat dipasang sebagai fungsi Lambda pada
 * image ini — prosesnya keluar, dan Lambda melaporkan runtime yang berhenti
 * tanpa alasan.
 *
 * **Migrasi berjalan ketika invocation datang, bukan ketika proses menyala.**
 * Menjalankannya saat menyala berarti menjalankannya pada setiap cold start,
 * termasuk cold start yang dipicu readiness check — dan penerapan yang gagal
 * akan menggagalkan penyalaan alih-alih melaporkan sebabnya.
 */

/** Jalur readiness check. Menjawab tanpa menyentuh basis data sama sekali. */
const JALUR_SEHAT = ["/healthz", "/api/healthz"];

/**
 * Jalur penerapan.
 *
 * `/migrasi` disetel Terraform sebagai `AWS_LWA_PASS_THROUGH_PATH`. `/events`
 * adalah bawaan adapter untuk pemicu non-HTTP, dan dipertahankan sebagai jaring
 * pengaman: apabila variabel itu terlupa disetel, yang terjadi adalah migrasi
 * tetap berjalan — bukan `404` yang membingungkan pada tengah rilis.
 */
const JALUR_TERAP = ["/migrasi", "/api/migrasi", "/events"];

export type HasilPenerapan = Readonly<{
  berhasil: boolean;
  diterapkan: readonly string[];
  sebab?: string;
}>;

export type PilihanLayananMigrasi = Readonly<{
  /** Menerapkan migrasi yang belum pernah dijalankan, lalu menyebut namanya. */
  terapkan: () => Promise<readonly string[]>;
}>;

export function buatLayananMigrasi(pilihan: PilihanLayananMigrasi): Server {
  return createServer((req, res) => {
    const jalur = (req.url ?? "/").split("?")[0] ?? "/";

    if (req.method === "GET" && JALUR_SEHAT.includes(jalur)) {
      jawab(res, 200, { data: { proses: "siap", peran: "migrasi" } });
      return;
    }

    if (req.method === "POST" && JALUR_TERAP.includes(jalur)) {
      // Body invocation tidak dibaca, dan itu disengaja. Penerapan migrasi tidak
      // memiliki satu pun parameter: yang dijalankan adalah seluruh berkas yang
      // belum pernah dijalankan, tidak kurang dan tidak lebih.
      req.resume();

      void pilihan
        .terapkan()
        .then((diterapkan) => {
          laporkan(diterapkan);
          jawab(res, 200, { data: hasil(true, diterapkan) });
        })
        .catch((galat: unknown) => {
          const sebab = galat instanceof Error ? galat.message : String(galat);
          console.error(`Migrasi gagal: ${sebab}`);
          // 500, dan pipeline TETAP wajib memeriksa isi jawabannya: `aws lambda
          // invoke` mengembalikan 200 selama fungsinya sendiri tidak melempar,
          // sehingga status HTTP di dalam payload adalah satu-satunya kabar
          // yang sampai — DEPLOYMENT.md §3.3 langkah 6.
          jawab(res, 500, {
            kesalahan: { kode: "MIGRASI_GAGAL", pesan: sebab },
            data: hasil(false, [], sebab),
          });
        });
      return;
    }

    jawab(res, 404, {
      kesalahan: {
        kode: "TIDAK_DITEMUKAN",
        pesan: `Fungsi migrate hanya melayani ${JALUR_TERAP.join(", ")}.`,
      },
    });
  });
}

function hasil(berhasil: boolean, diterapkan: readonly string[], sebab?: string): HasilPenerapan {
  return Object.freeze(
    sebab === undefined ? { berhasil, diterapkan } : { berhasil, diterapkan, sebab },
  );
}

function laporkan(diterapkan: readonly string[]): void {
  if (diterapkan.length === 0) {
    console.log("Tidak ada migrasi baru. Skema sudah mutakhir.");
    return;
  }
  console.log(`${diterapkan.length} migrasi diterapkan:`);
  for (const nama of diterapkan) console.log(`  ${nama}`);
}

function jawab(res: ServerResponse, status: number, isi: unknown) {
  const badan = JSON.stringify(isi);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(badan),
  });
  res.end(badan);
}
