/**
 * Admin password reset and setup codes, against the real Postgres instance at
 * DATABASE_URL (see vitest.setup.ts) — no mocking of Prisma.
 *
 * What these pin down:
 *   - a reset is ALWAYS repeatable, and each one kills the previous code;
 *   - a reset leaves exactly one credential (passwordHash null, setupCode set),
 *     and the database itself refuses a row holding both;
 *   - two rapid resets of one member produce one code, not two;
 *   - "Resend code" shows the current code and changes nothing.
 *
 * Sign-in goes through lib/credentials.ts checkCredentials against the row as
 * getAuthRecord returns it — exactly what src/auth.ts authorize() does.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { checkCredentials } from "./credentials";
import { hashPassword } from "./passwords";
import { prisma } from "./prisma";
import {
  RESET_REPEAT_WINDOW_MS,
  createMemberAccount,
  getAccountAccess,
  getAuthRecord,
  resetPassword,
  revealSetupCode,
  setPassword,
} from "./repo";
import { Role } from "@/generated/prisma/enums";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
// bcrypt at cost 12, several times per test.
vi.setConfig({ testTimeout: 60_000 });

const ORIGINAL_PASSWORD = "original-passphrase-42";

let orgId: string;
let adminEmail: string;
let otherAdminEmail: string;
let originalHash: string;

beforeAll(async () => {
  const org = await prisma.org.create({
    data: { slug: `reset-test-${randomUUID()}`, name: "Reset Test Org", shortName: "RT" },
  });
  orgId = org.id;
  adminEmail = `admin-${randomUUID()}@bison.howard.edu`;
  otherAdminEmail = `admin2-${randomUUID()}@bison.howard.edu`;
  originalHash = await hashPassword(ORIGINAL_PASSWORD);
  await prisma.user.createMany({
    data: [
      { orgId, email: adminEmail, firstName: "Ada", lastName: "Admin", role: Role.ADMIN, passwordHash: originalHash },
      { orgId, email: otherAdminEmail, firstName: "Alan", lastName: "Admin", role: Role.ADMIN, passwordHash: originalHash },
    ],
  });
}, 60_000);

afterAll(async () => {
  await prisma.adminLog.deleteMany({ where: { orgId } });
  await prisma.config.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.org.delete({ where: { id: orgId } });
});

/** A member with a real password. `mustChangePassword: true` makes it a LEGACY pending account (its "code" is the hash). */
async function makeMember(options: { email?: string; mustChangePassword?: boolean } = {}): Promise<string> {
  const email = options.email ?? `member-${randomUUID()}@bison.howard.edu`;
  await prisma.user.create({
    data: {
      orgId,
      email,
      firstName: "Grace",
      lastName: "Hopper",
      role: Role.GENERAL,
      passwordHash: originalHash,
      mustChangePassword: options.mustChangePassword ?? false,
    },
  });
  return email;
}

async function signIn(email: string, typed: string) {
  const record = await getAuthRecord(orgId, email);
  if (!record) throw new Error(`no auth record for ${email}`);
  return checkCredentials(record, typed);
}

function row(email: string) {
  return prisma.user.findFirstOrThrow({ where: { orgId, email } });
}

/** As if the admin came back after the double-submit window — a deliberate second reset. */
async function outsideRepeatWindow(email: string): Promise<void> {
  await prisma.user.update({
    where: { orgId_email: { orgId, email } },
    data: { setupCodeIssuedAt: new Date(Date.now() - RESET_REPEAT_WINDOW_MS - 1_000) },
  });
}

function resetsLogged(email: string): Promise<number> {
  return prisma.adminLog.count({ where: { orgId, action: "reset_password", target: email } });
}

function expectSingleCredential(r: { passwordHash: string | null; setupCode: string | null; mustChangePassword: boolean }) {
  expect(r.passwordHash).toBeNull();
  expect(r.setupCode).not.toBeNull();
  expect(r.mustChangePassword).toBe(true);
}

describe("reset is always repeatable", () => {
  it("resetting an already-reset member succeeds and issues a new code", async () => {
    const email = await makeMember();
    const first = await resetPassword(orgId, email, adminEmail);
    await outsideRepeatWindow(email);

    const second = await resetPassword(orgId, email, adminEmail);

    expect(second.reused).toBe(false);
    expect(second.setupCode).not.toBe(first.setupCode);
    expect(await resetsLogged(email)).toBe(2);
  });

  it("the old code stops working after a second reset, and the new one works", async () => {
    const email = await makeMember();
    const first = await resetPassword(orgId, email, adminEmail);
    await expect(signIn(email, first.setupCode)).resolves.toEqual({ ok: true, mustChangePassword: true });
    await outsideRepeatWindow(email);

    const second = await resetPassword(orgId, email, adminEmail);

    await expect(signIn(email, first.setupCode)).resolves.toEqual({ ok: false });
    await expect(signIn(email, second.setupCode)).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("the member's previous password stops working immediately", async () => {
    const email = await makeMember();
    await expect(signIn(email, ORIGINAL_PASSWORD)).resolves.toEqual({ ok: true, mustChangePassword: false });

    await resetPassword(orgId, email, adminEmail);

    await expect(signIn(email, ORIGINAL_PASSWORD)).resolves.toEqual({ ok: false });
  });

  it("works from every state: active, legacy pending, just created, and reset many times over", async () => {
    const active = await makeMember();
    const legacy = await makeMember({ mustChangePassword: true });
    const createdEmail = `created-${randomUUID()}@bison.howard.edu`;
    await createMemberAccount(orgId, createdEmail, "New", "Member", "general", otherAdminEmail);

    for (const email of [active, legacy, createdEmail]) {
      const issued = await resetPassword(orgId, email, adminEmail);
      expect(issued.reused).toBe(false);
      await expect(signIn(email, issued.setupCode)).resolves.toEqual({ ok: true, mustChangePassword: true });
    }

    let last = "";
    for (let i = 0; i < 4; i++) {
      await outsideRepeatWindow(active);
      const issued = await resetPassword(orgId, active, adminEmail);
      expect(issued.setupCode).not.toBe(last);
      last = issued.setupCode;
    }
    await expect(signIn(active, last)).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("an unknown member is a NOT_FOUND, not a silent success", async () => {
    await expect(resetPassword(orgId, `ghost-${randomUUID()}@bison.howard.edu`, adminEmail)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("one credential, never both", () => {
  it("reset always leaves passwordHash null and setupCode set — from an active or a legacy pending account", async () => {
    const active = await makeMember();
    const legacy = await makeMember({ mustChangePassword: true });

    await resetPassword(orgId, active, adminEmail);
    await resetPassword(orgId, legacy, adminEmail);

    expectSingleCredential(await row(active));
    expectSingleCredential(await row(legacy));
  });

  it("a created account starts in the same shape", async () => {
    const email = `created-${randomUUID()}@bison.howard.edu`;
    const { setupCode } = await createMemberAccount(orgId, email, "New", "Member", "general", adminEmail);

    expectSingleCredential(await row(email));
    await expect(signIn(email, setupCode.toLowerCase())).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("setting a password clears the code in the same write", async () => {
    const email = await makeMember();
    const { setupCode } = await resetPassword(orgId, email, adminEmail);

    await setPassword(orgId, email, "brand-new-passphrase-7");

    const after = await row(email);
    expect(after.passwordHash).not.toBeNull();
    expect(after.setupCode).toBeNull();
    expect(after.mustChangePassword).toBe(false);
    await expect(signIn(email, setupCode)).resolves.toEqual({ ok: false });
  });

  it("the database refuses a row that holds both", async () => {
    const email = await makeMember();
    await resetPassword(orgId, email, adminEmail);

    await expect(
      prisma.user.update({ where: { orgId_email: { orgId, email } }, data: { passwordHash: originalHash } }),
    ).rejects.toThrow();
    expectSingleCredential(await row(email));
  });
});

describe("double submit", () => {
  it("two rapid reset requests produce one code", async () => {
    const email = await makeMember();

    const [a, b] = await Promise.all([
      resetPassword(orgId, email, adminEmail),
      resetPassword(orgId, email, adminEmail),
    ]);

    expect(a.setupCode).toBe(b.setupCode);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(await resetsLogged(email)).toBe(1);
    await expect(signIn(email, a.setupCode)).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("a repeat that arrives just after the first finished returns the same code", async () => {
    const email = await makeMember();

    const first = await resetPassword(orgId, email, adminEmail);
    const repeat = await resetPassword(orgId, email, adminEmail);

    expect(repeat).toMatchObject({ setupCode: first.setupCode, reused: true });
    expect(await resetsLogged(email)).toBe(1);
    await expect(signIn(email, first.setupCode)).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("the window is keyed on the admin too: a different admin inside it still issues a new code", async () => {
    const email = await makeMember();

    const mine = await resetPassword(orgId, email, adminEmail);
    const theirs = await resetPassword(orgId, email, otherAdminEmail);

    expect(theirs.reused).toBe(false);
    expect(theirs.setupCode).not.toBe(mine.setupCode);
  });
});

describe("Resend code", () => {
  it("shows the existing code without generating a new one", async () => {
    const email = await makeMember();
    const issued = await resetPassword(orgId, email, adminEmail);
    const before = await row(email);

    const shown = await revealSetupCode(orgId, email, adminEmail);

    expect(shown?.setupCode).toBe(issued.setupCode);
    const after = await row(email);
    expect(after.setupCode).toBe(before.setupCode);
    expect(after.setupCodeIssuedAt).toEqual(before.setupCodeIssuedAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await resetsLogged(email)).toBe(1);
    expect(await prisma.adminLog.count({ where: { orgId, action: "view_setup_code", target: email } })).toBe(1);
    await expect(signIn(email, issued.setupCode)).resolves.toEqual({ ok: true, mustChangePassword: true });
  });

  it("has nothing to show once the member has chosen a password, or for a legacy pending code", async () => {
    const email = await makeMember();
    await resetPassword(orgId, email, adminEmail);
    await setPassword(orgId, email, "brand-new-passphrase-7");
    await expect(revealSetupCode(orgId, email, adminEmail)).resolves.toBeNull();

    const legacy = await makeMember({ mustChangePassword: true });
    await expect(revealSetupCode(orgId, legacy, adminEmail)).resolves.toBeNull();
  });
});

describe("sign-in with a setup code", () => {
  it("a member signs in with the code, is flagged to set a password, and afterwards signs in with the password only", async () => {
    const email = await makeMember();
    const { setupCode } = await resetPassword(orgId, email, adminEmail);

    await expect(signIn(email, ` ${setupCode.slice(0, 4).toLowerCase()}-${setupCode.slice(4)} `)).resolves.toEqual({
      ok: true,
      mustChangePassword: true,
    });

    await setPassword(orgId, email, "brand-new-passphrase-7");
    await expect(signIn(email, "brand-new-passphrase-7")).resolves.toEqual({ ok: true, mustChangePassword: false });
  });
});

describe("account access panel", () => {
  it("reports Reset pending, when, and who — then Active once a password is set", async () => {
    const email = await makeMember();
    await resetPassword(orgId, email, adminEmail);

    const pending = await getAccountAccess(orgId, email);
    expect(pending.state).toBe("reset_pending");
    expect(pending.codeRetrievable).toBe(true);
    expect(pending.lastIssued).toMatchObject({ action: "reset_password", actor: adminEmail });
    expect(pending.lastIssued?.at).toBeInstanceOf(Date);

    await setPassword(orgId, email, "brand-new-passphrase-7");
    const active = await getAccountAccess(orgId, email);
    expect(active.state).toBe("active");
    expect(active.codeRetrievable).toBe(false);
  });

  it("flags an email that can't pass the sign-in domain gate", async () => {
    await prisma.config.create({ data: { orgId, key: "ALLOWED_EMAIL_DOMAIN", value: "bison.howard.edu" } });
    try {
      const outside = await makeMember({ email: `someone-${randomUUID()}@gmail.com` });
      const inside = await makeMember();
      expect((await getAccountAccess(orgId, outside)).loginAllowed).toBe(false);
      expect((await getAccountAccess(orgId, inside)).loginAllowed).toBe(true);
    } finally {
      await prisma.config.deleteMany({ where: { orgId, key: "ALLOWED_EMAIL_DOMAIN" } });
    }
  });
});
