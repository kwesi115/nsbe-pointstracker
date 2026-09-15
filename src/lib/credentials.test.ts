import { beforeAll, describe, expect, it, vi } from "vitest";
import { checkCredentials } from "./credentials";
import { hashPassword } from "./passwords";
import { sealSetupCode } from "./setup-code";

// Every branch pays a cost-12 bcrypt compare, by design.
vi.setConfig({ testTimeout: 30_000 });

const CODE = "ABCD2345";
const PASSWORD = "Correct-Horse-Battery-9";

let passwordHash: string;
let legacyCodeHash: string;

beforeAll(async () => {
  process.env.CODE_SECRET ??= "test-code-secret";
  [passwordHash, legacyCodeHash] = await Promise.all([hashPassword(PASSWORD), hashPassword(CODE)]);
}, 60_000);

function pending() {
  return { role: "general" as const, passwordHash: null, setupCode: sealSetupCode(CODE), mustChangePassword: true };
}

describe("a pending setup code", () => {
  it("is accepted as typed, and flags the session to set a password", async () => {
    await expect(checkCredentials(pending(), CODE)).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("is accepted with different casing", async () => {
    await expect(checkCredentials(pending(), "abcd2345")).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("is accepted with surrounding whitespace", async () => {
    await expect(checkCredentials(pending(), "  ABCD2345 ")).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("is accepted with hyphens and spaces stripped", async () => {
    await expect(checkCredentials(pending(), "abcd-2345")).resolves.toEqual({ ok: true, mustChangePassword: true });
    await expect(checkCredentials(pending(), "ABCD 2345")).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("rejects a wrong code", async () => {
    await expect(checkCredentials(pending(), "ABCD2346")).resolves.toEqual({ ok: false });
  });

  it("never lets a guest row in, even holding a code", async () => {
    await expect(checkCredentials({ ...pending(), role: "guest" }, CODE)).resolves.toEqual({ ok: false });
  });
});

describe("a real password", () => {
  function active() {
    return { role: "general" as const, passwordHash, setupCode: null, mustChangePassword: false };
  }

  it("is accepted exactly", async () => {
    await expect(checkCredentials(active(), PASSWORD)).resolves.toEqual({ ok: true, mustChangePassword: false });
  });

  it("is never normalized: casing and whitespace still matter", async () => {
    await expect(checkCredentials(active(), PASSWORD.toLowerCase())).resolves.toEqual({ ok: false });
    await expect(checkCredentials(active(), ` ${PASSWORD} `)).resolves.toEqual({ ok: false });
  });

  it("an account with no credential at all never signs in", async () => {
    await expect(
      checkCredentials({ role: "general", passwordHash: null, setupCode: null, mustChangePassword: true }, ""),
    ).resolves.toEqual({ ok: false });
  });
});

describe("a legacy pending code (bcrypt hash of the code in passwordHash)", () => {
  it("gets the same forgiveness while mustChangePassword is set", async () => {
    const legacy = { role: "general" as const, passwordHash: legacyCodeHash, setupCode: null, mustChangePassword: true };
    await expect(checkCredentials(legacy, " abcd-2345 ")).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("but not once the account is active — a password is never normalized", async () => {
    const active = { role: "general" as const, passwordHash: legacyCodeHash, setupCode: null, mustChangePassword: false };
    await expect(checkCredentials(active, "abcd2345")).resolves.toEqual({ ok: false });
  });
});
