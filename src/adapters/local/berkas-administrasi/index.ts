import type { BerkasAdministrasi } from "../../../ports/berkas-administrasi.js";
import { buatCsvKredensial, buatTemplatAkunCsv, uraiAkunCsv } from "./csv.js";
import { buatTemplatDaftarSiswaXlsx, uraiDaftarSiswaXlsx } from "./xlsx.js";

export function berkasAdministrasiLokal(): BerkasAdministrasi {
  return {
    uraiAkunCsv,
    uraiDaftarSiswaXlsx,
    async buatCsvKredensial(baris) {
      return buatCsvKredensial(baris);
    },
    async buatTemplatAkunCsv(peran) {
      return buatTemplatAkunCsv(peran);
    },
    buatTemplatDaftarSiswaXlsx,
  };
}
