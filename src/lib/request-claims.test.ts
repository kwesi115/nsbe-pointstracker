/**
 * Server-side double-submit protection, against the real Postgres instance at
 * DATABASE_URL (see vitest.setup.ts).
 *
 * A disabled confirm button is a UX affordance, not a guarantee — a slow
 * network and an impatient admin still produce two requests. Rotate join code
 * GENERATES A CREDENTIAL, so a second fire invalidates the chapter-wide signup
 * code the admin is currently reading off the screen.
 *
 * It claims the client's requestToken in the same transaction as its work (see
 * lib/repo.ts claimRequestToken and model RequestClaim), so the unique index is
 * what makes the second one impossible rather than unlikely. These tests fire
 * the two requests CONCURRENTLY, which is the case a "was there a recent one?"
 * SELECT would not survive.
 *
 * Password reset collapses repeats per member instead — see
 * lib/reset-password.test.ts.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { verifyPassword } from "./passwords";
import { prisma } from "./prisma";
import { createJoinCode, rotateJoinCodeById } from "./repo";
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

function settledErrors(results: PromiseSettledResult<unknown>[]): AppError[] {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason)
    .filter((e): e is AppError => e instanceof AppError);
}

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
