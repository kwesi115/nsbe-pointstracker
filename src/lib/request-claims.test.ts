/**
 * Server-side double-submit protection, against the real Postgres instance at
 * DATABASE_URL (see vitest.setup.ts).
 *
 * A disabled confirm button is a UX affordance, not a guarantee — a slow
 * network and an impatient admin still produce two requests. For the two admin
 * actions that GENERATE A CREDENTIAL that is not cosmetic:
 *
 *   - reset password regenerates a setup code, so a second fire invalidates the
 *     code the admin is currently reading off the screen;
 *   - rotate join code does the same to a chapter-wide signup code.
 *
 * Both now claim the client's requestToken in the same transaction as their
 * work (see lib/repo.ts claimRequestToken and model RequestClaim), so the
 * unique index is what makes the second one impossible rather than unlikely.
 * These tests fire the two requests CONCURRENTLY, which is the case a
 * "was there a recent one?" SELECT would not survive.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { verifyPassword } from "./passwords";
import { prisma } from "./prisma";
import { createJoinCode, resetPassword, rotateJoinCodeById } from "./repo";
import { Role } from "@/generated/prisma/enums";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

let orgId: string;
let adminEmail: string;

beforeAll(async () => {
  const org = await prisma.org.create({
    data: { slug: `claims-test-${randomUUID()}`, name: "Claims Test Org", shortName: "CT" },
  });
  orgId = org.id;
  adminEmail = `admin-${randomUUID()}@bison.howard.edu`;
  await prisma.user.create({
    data: { orgId, email: adminEmail, firstName: "Ada", lastName: "Admin", role: Role.ADMIN, passwordHash: "x" },
  });
});

afterAll(async () => {
  await prisma.requestClaim.deleteMany({ where: { orgId } });
  await prisma.adminLog.deleteMany({ where: { orgId } });
  await prisma.joinCode.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.org.delete({ where: { id: orgId } });
});

async function makeMember(): Promise<string> {
  const email = `member-${randomUUID()}@bison.howard.edu`;
  await prisma.user.create({
    data: { orgId, email, firstName: "Grace", lastName: "Hopper", role: Role.GENERAL, passwordHash: "x" },
  });
  return email;
}

function settledErrors(results: PromiseSettledResult<unknown>[]): AppError[] {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason)
    .filter((e): e is AppError => e instanceof AppError);
}

describe("two rapid reset-password requests produce one setup code", () => {
  it("fired concurrently with the same token: one code issued, one reset logged", async () => {
    const email = await makeMember();
    const requestToken = randomUUID();

    const results = await Promise.allSettled([
      resetPassword(orgId, email, adminEmail, { requestToken }),
      resetPassword(orgId, email, adminEmail, { requestToken }),
    ]);

    const codes = results.filter((r) => r.status === "fulfilled").map((r) => r.value as string);
    expect(codes).toHaveLength(1);

    const errors = settledErrors(results);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("DUPLICATE_REQUEST");

    // The one code that came back is the one the member can actually sign in
    // with — the loser wrote no passwordHash at all.
    const row = await prisma.user.findFirstOrThrow({ where: { orgId, email } });
    expect(await verifyPassword(codes[0], row.passwordHash!)).toBe(true);
    expect(row.mustChangePassword).toBe(true);

    // And the audit trail says one reset, not two.
    const logged = await prisma.adminLog.count({ where: { orgId, action: "reset_password", target: email } });
    expect(logged).toBe(1);
    expect(await prisma.requestClaim.count({ where: { orgId, scope: "reset_password", token: requestToken } })).toBe(1);
  });

  it("a repeat that arrives after the first has finished is refused too", async () => {
    const email = await makeMember();
    const requestToken = randomUUID();

    const code = await resetPassword(orgId, email, adminEmail, { requestToken });
    await expect(resetPassword(orgId, email, adminEmail, { requestToken })).rejects.toMatchObject({
      code: "DUPLICATE_REQUEST",
    });

    // Still the first code: the repeat did not touch the password.
    const row = await prisma.user.findFirstOrThrow({ where: { orgId, email } });
    expect(await verifyPassword(code, row.passwordHash!)).toBe(true);
  });

  it("a deliberate second reset — a new confirmation, a new token — is allowed", async () => {
    const email = await makeMember();

    const first = await resetPassword(orgId, email, adminEmail, { requestToken: randomUUID() });
    const second = await resetPassword(orgId, email, adminEmail, { requestToken: randomUUID() });

    expect(second).not.toBe(first);
    const row = await prisma.user.findFirstOrThrow({ where: { orgId, email } });
    expect(await verifyPassword(second, row.passwordHash!)).toBe(true);
    expect(await verifyPassword(first, row.passwordHash!)).toBe(false);
  });

  it("a failed reset leaves no claim behind, so the retry works", async () => {
    const requestToken = randomUUID();
    // Nobody by this address: the transaction rolls back, claim included.
    await expect(
      resetPassword(orgId, `ghost-${randomUUID()}@bison.howard.edu`, adminEmail, { requestToken }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.requestClaim.count({ where: { orgId, token: requestToken } })).toBe(0);

    const email = await makeMember();
    await expect(resetPassword(orgId, email, adminEmail, { requestToken })).resolves.toBeTruthy();
  });

  it("the same token against a DIFFERENT member is still collapsed — one confirmation, one action", async () => {
    // The token identifies one intent, not one row. Two members cannot be
    // reset by one confirmation, so the second is refused.
    const requestToken = randomUUID();
    const first = await makeMember();
    const second = await makeMember();

    await expect(resetPassword(orgId, first, adminEmail, { requestToken })).resolves.toBeTruthy();
    await expect(resetPassword(orgId, second, adminEmail, { requestToken })).rejects.toMatchObject({
      code: "DUPLICATE_REQUEST",
    });
  });
});

describe("two rapid rotate-join-code requests produce one rotation", () => {
  async function makeCode(): Promise<string> {
    const { summary } = await createJoinCode({
      orgId,
      label: `rotate-${randomUUID()}`,
      grantsRole: "general",
      createdBy: adminEmail,
    });
    return summary.id;
  }

  it("fired concurrently with the same token: one new code, one rotation logged", async () => {
    const id = await makeCode();
    const requestToken = randomUUID();

    const results = await Promise.allSettled([
      rotateJoinCodeById(orgId, id, adminEmail, { requestToken }),
      rotateJoinCodeById(orgId, id, adminEmail, { requestToken }),
    ]);

    const rotations = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    expect(rotations).toHaveLength(1);
    expect(settledErrors(results).map((e) => e.code)).toEqual(["DUPLICATE_REQUEST"]);

    // Exactly one replacement row exists, and its plaintext is the one returned.
    const replacements = await prisma.joinCode.findMany({
      where: { orgId, label: (await prisma.joinCode.findFirstOrThrow({ where: { id } })).label, rotatedAt: null },
    });
    expect(replacements).toHaveLength(1);
    expect(await verifyPassword(rotations[0].plaintext, replacements[0].code)).toBe(true);

    const logged = await prisma.adminLog.count({ where: { orgId, action: "rotate_join_code", target: replacements[0].id } });
    expect(logged).toBe(1);

    // The rotated original is deactivated exactly once.
    const original = await prisma.joinCode.findFirstOrThrow({ where: { id } });
    expect(original.active).toBe(false);
    expect(original.rotatedAt).not.toBeNull();
  });

  it("a repeat after the first finished is refused, leaving the shown code valid", async () => {
    const id = await makeCode();
    const requestToken = randomUUID();

    const { plaintext, summary } = await rotateJoinCodeById(orgId, id, adminEmail, { requestToken });
    await expect(rotateJoinCodeById(orgId, id, adminEmail, { requestToken })).rejects.toMatchObject({
      code: "DUPLICATE_REQUEST",
    });

    const current = await prisma.joinCode.findFirstOrThrow({ where: { id: summary.id } });
    expect(current.active).toBe(true);
    expect(await verifyPassword(plaintext, current.code)).toBe(true);
  });

  it("a deliberate second rotation with a fresh token rotates again", async () => {
    const id = await makeCode();
    const first = await rotateJoinCodeById(orgId, id, adminEmail, { requestToken: randomUUID() });
    const second = await rotateJoinCodeById(orgId, first.summary.id, adminEmail, { requestToken: randomUUID() });

    expect(second.plaintext).not.toBe(first.plaintext);
    const firstReplacement = await prisma.joinCode.findFirstOrThrow({ where: { id: first.summary.id } });
    expect(firstReplacement.active).toBe(false);
  });
});
