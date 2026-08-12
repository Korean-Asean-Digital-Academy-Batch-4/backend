import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { rahasiaAws } from "../../../../src/adapters/aws/rahasia.js";

const tiruanRahasia = mockClient(SecretsManagerClient);
const tiruanParameter = mockClient(SSMClient);

const PILIHAN = {
  inang: "edutrack.abc123.ap-southeast-3.rds.amazonaws.com",
  porta: 5432,
  basisData: "edutrack",
  rujukan: {
    app_rw: "edutrack/db/app_rw",
    app_ro: "edutrack/db/app_ro",
    // Nama rahasia terkelola RDS tidak dapat disepakati di muka, sehingga
    // yang diteruskan adalah ARN-nya — DEPLOYMENT.md sec 5.1, CK-D-06.
    owner: "arn:aws:secretsmanager:ap-southeast-3:274286556151:secret:rds!db-xyz-AbCdEf",
  },
  parameterKunciAi: "/edutrack/ai/elice-api-key",
} as const;

function buatRahasia() {
  return rahasiaAws({
    ...PILIHAN,
    klienRahasia: new SecretsManagerClient({ region: "ap-southeast-3" }),
    klienParameter: new SSMClient({ region: "ap-southeast-3" }),
  });
}

beforeEach(() => {
  tiruanRahasia.reset();
  tiruanParameter.reset();
});

describe("rahasiaAws.urlBasisData", () => {
  it("menyusun URL dari kredensial Secrets Manager beserta inang dari lingkungan", async () => {
    tiruanRahasia
      .on(GetSecretValueCommand, { SecretId: PILIHAN.rujukan.app_rw })
      .resolves({ SecretString: JSON.stringify({ username: "app_rw", password: "sandi" }) });

    await expect(buatRahasia().urlBasisData("app_rw")).resolves.toBe(
      `postgresql://app_rw:sandi@${PILIHAN.inang}:5432/edutrack?sslmode=verify-full`,
    );
  });

  it("mematok verify-full, bukan require — CK-A-13", async () => {
    tiruanRahasia
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ username: "app_rw", password: "s" }) });

    // `require` hari ini berarti verify-full pada pg 8, tetapi pg memperingatkan
    // artinya akan MELEMAH pada v9. Nilai yang dipatok membuat peningkatan
    // pustaka tidak diam-diam mematikan verifikasi sertifikat RDS.
    await expect(buatRahasia().urlBasisData("app_rw")).resolves.not.toContain("sslmode=require");
  });

  it("meminta rahasia yang berbeda untuk peran yang berbeda", async () => {
    tiruanRahasia
      .on(GetSecretValueCommand, { SecretId: PILIHAN.rujukan.owner })
      .resolves({ SecretString: JSON.stringify({ username: "edutrack_owner", password: "x" }) });

    await expect(buatRahasia().urlBasisData("owner")).resolves.toContain("edutrack_owner:x@");
  });

  it("menyandikan kata sandi berkarakter khusus, sehingga URL tetap terurai benar", async () => {
    tiruanRahasia
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ username: "app_ro", password: "a/b@c:d" }) });

    const url = await buatRahasia().urlBasisData("app_ro");

    expect(url).toContain("a%2Fb%40c%3Ad");
    expect(new URL(url).hostname).toBe(PILIHAN.inang);
  });

  it("menolak rahasia yang bukan JSON", async () => {
    tiruanRahasia.on(GetSecretValueCommand).resolves({ SecretString: "sandi-telanjang" });

    await expect(buatRahasia().urlBasisData("app_rw")).rejects.toThrow(/app_rw/);
  });

  it("menolak rahasia yang tidak memuat kata sandi", async () => {
    tiruanRahasia
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ username: "app_rw" }) });

    await expect(buatRahasia().urlBasisData("app_rw")).rejects.toThrow(/app_rw/);
  });

  it("menolak rahasia biner yang tidak memiliki SecretString sama sekali", async () => {
    tiruanRahasia.on(GetSecretValueCommand).resolves({});

    await expect(buatRahasia().urlBasisData("app_rw")).rejects.toThrow(/app_rw/);
  });

  it("tidak pernah menyertakan isi rahasia pada pesan galatnya", async () => {
    tiruanRahasia.on(GetSecretValueCommand).resolves({ SecretString: "sandi-rahasia-sekali" });

    // Techstack.md sec 7 butir 2 — rahasia tidak pernah dicetak ke log, dan
    // pesan galat adalah jalur tercepat sebuah rahasia sampai ke CloudWatch.
    const galat = await buatRahasia()
      .urlBasisData("app_rw")
      .then(
        () => undefined,
        (sebab: unknown) => sebab,
      );

    expect(galat).toBeInstanceOf(Error);
    expect(String(galat)).not.toContain("sandi-rahasia-sekali");
  });
});

describe("rahasiaAws.kunciApiAi", () => {
  it("membaca parameter SecureString dengan mendekripsinya", async () => {
    tiruanParameter
      .on(GetParameterCommand, { Name: PILIHAN.parameterKunciAi, WithDecryption: true })
      .resolves({ Parameter: { Value: "kunci-elice" } });

    await expect(buatRahasia().kunciApiAi()).resolves.toBe("kunci-elice");
  });

  it("menolak parameter yang nilainya kosong", async () => {
    tiruanParameter.on(GetParameterCommand).resolves({ Parameter: {} });

    await expect(buatRahasia().kunciApiAi()).rejects.toThrow(/elice-api-key/);
  });
});
