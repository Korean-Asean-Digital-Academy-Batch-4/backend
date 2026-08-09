import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { KODE } from "../../../src/routes/amplop.js";
import { wajibAdministrator } from "../../../src/routes/middleware-kewenangan.js";

type ResponsTiruan = Response & {
  statusCode: number;
  badan?: {
    kesalahan: {
      kode: string;
      pesan: string;
    };
  };
};

function konteksMiddleware({ peran }: { peran?: string }): {
  req: Request;
  res: ResponsTiruan;
  next: NextFunction;
} {
  const res: ResponsTiruan = {
    statusCode: 200,
    status(status: number) {
      this.statusCode = status;
      return this;
    },
    json(badan: ResponsTiruan["badan"]) {
      this.badan = badan;
      return this;
    },
  } as ResponsTiruan;

  return {
    req: {
      ...(peran ? { penuntut: { penggunaRef: "pengguna-1", peran, token: "token-1" } } : {}),
    } as Request,
    res,
    next: vi.fn(),
  };
}

describe("wajibAdministrator", () => {
  it.each(["guru", "siswa"] as const)("menolak peran %s dengan 403", (peran) => {
    const { req, res, next } = konteksMiddleware({ peran });

    wajibAdministrator()(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.badan?.kesalahan.kode).toBe("KEWENANGAN_DITOLAK");
    expect(next).not.toHaveBeenCalled();
  });

  it("menolak penuntut yang belum terautentikasi", () => {
    const { req, res, next } = konteksMiddleware({});

    wajibAdministrator()(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.badan?.kesalahan.kode).toBe(KODE.kewenanganDitolak);
    expect(next).not.toHaveBeenCalled();
  });

  it("meneruskan Administrator", () => {
    const { req, res, next } = konteksMiddleware({ peran: "administrator" });

    wajibAdministrator()(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
