/**
 * Runs against the real Postgres instance at DATABASE_URL (see
 * vitest.setup.ts) — no mocking of Prisma. Every test creates its own org
 * (randomUUID-suffixed slug) and cleans up everything scoped to it in
 * afterEach, so it can't collide with seeded dev data or other tests.
 */

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Role as DbRole } from "@/generated/prisma/enums";
import { currentCode } from "./code";
import { AppError } from "./errors";
import { hashPassword, verifyPassword } from "./passwords";
import { prisma } from "./prisma";
import {
  getAuthRecord,
  matchJoinCode,
  redeemGuestJoinCode,
  redeemJoinCodeForSignup,
  registerGuest,
} from "./repo";

let createdOrgIds: string[] = [];

afterEach(async () => {
  if (createdOrgIds.length === 0) return;
  const orgId = { in: createdOrgIds };
  await prisma.answer.deleteMany({ where: { registration: { event: { orgId } } } });
  await prisma.registration.deleteMany({ where: { event: { orgId } } });
  await prisma.formField.deleteMany({ where: { event: { orgId } } });
  await prisma.event.deleteMany({ where: { orgId } });
  await prisma.eventCategory.deleteMany({ where: { orgId } });
  await prisma.joinCode.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.config.deleteMany({ where: { orgId } });
  await prisma.adminLog.deleteMany({ where: { orgId } });
  await prisma.org.deleteMany({ where: { id: { in: createdOrgIds } } });
  createdOrgIds = [];
});

async function makeOrg() {
  const org = await prisma.org.create({
    data: { slug: `test-org-${randomUUID()}`, name: "Test Org", shortName: "TO" },
  });
  createdOrgIds.push(org.id);
  return org;
}

async function makeCategory(orgId: string) {
  return prisma.eventCategory.create({
    data: { orgId, code: `SOCIAL_${randomUUID()}`, name: "Social Event", shortName: "Social", tier: 3, memberPoints: 1, sortOrder: 0 },
  });
}

async function makeJoinCode(
  orgId: string,
  overrides: Partial<{
    grantsRole: DbRole;
    active: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    useCount: number;
  }> = {},
) {
  const plaintext = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  const code = await hashPassword(plaintext);
  const row = await prisma.joinCode.create({
    data: {
      orgId,
      code,
      codeHint: `${plaintext.slice(0, 2)}••••`,
      label: `Test code ${randomUUID()}`,
      grantsRole: overrides.grantsRole ?? DbRole.GENERAL,
      active: overrides.active ?? true,
      expiresAt: overrides.expiresAt ?? null,
      maxUses: overrides.maxUses ?? null,
      useCount: overrides.useCount ?? 0,
    },
  });
  return { row, plaintext };
}

const GENERIC_MESSAGE = "That join code doesn't work. Check it and try again.";

describe("join code redemption — role escalation fix (Part 3)", () => {
  it("a GENERAL code always creates a GENERAL account, regardless of any 'intended' role the UI collected", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { grantsRole: DbRole.GENERAL });

    // redeemJoinCodeForSignup has no "requested role" parameter at all — the
    // matched code is the only source of truth. This is the whole test: even
    // though a real /join wizard would have let someone pick "Admin" in step
    // 1, nothing about that choice ever reaches this function.
    const result = await redeemJoinCodeForSignup({
      orgId: org.id,
      submittedCode: plaintext,
      email: `escalation-${randomUUID()}@bison.howard.edu`,
      passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
      firstName: "Test",
      lastName: "User",
    });

    expect(result.grantsRole).toBe("general");
    expect(result.member.role).toBe("general");
  });

  it("an ADMIN code actually grants admin — the same function, a different code", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { grantsRole: DbRole.ADMIN });

    const result = await redeemJoinCodeForSignup({
      orgId: org.id,
      submittedCode: plaintext,
      email: `admin-${randomUUID()}@bison.howard.edu`,
      passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
      firstName: "Test",
      lastName: "Admin",
    });

    expect(result.grantsRole).toBe("admin");
  });
});

describe("codeless signup — general membership needs no code", () => {
  it("an empty submittedCode creates a GENERAL account outright — no code needed", async () => {
    const org = await makeOrg();
    const result = await redeemJoinCodeForSignup({
      orgId: org.id,
      submittedCode: "",
      email: `nocode-${randomUUID()}@bison.howard.edu`,
      passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
      firstName: "Test",
      lastName: "User",
    });
    expect(result.grantsRole).toBe("general");
    expect(result.member.role).toBe("general");
  });

  it("a whitespace-only submittedCode is treated the same as no code at all", async () => {
    const org = await makeOrg();
    const result = await redeemJoinCodeForSignup({
      orgId: org.id,
      submittedCode: "   ",
      email: `whitespace-${randomUUID()}@bison.howard.edu`,
      passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
      firstName: "Test",
      lastName: "User",
    });
    expect(result.grantsRole).toBe("general");
  });

  it("signing up with no code — as if claiming ADMIN in the wizard's picker but never entering a code — still only ever creates GENERAL, never the claimed role", async () => {
    // redeemJoinCodeForSignup has no "claimed role" parameter at all (see the
    // role-escalation test above) — this is that same guarantee applied to
    // the no-code path specifically. Nothing about what the /join wizard's
    // step-1 picker collected ever reaches this function.
    const org = await makeOrg();
    const result = await redeemJoinCodeForSignup({
      orgId: org.id,
      submittedCode: "",
      email: `claimed-admin-nocode-${randomUUID()}@bison.howard.edu`,
      passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
      firstName: "Test",
      lastName: "User",
    });
    expect(result.grantsRole).toBe("general");
  });

  it("no code entered doesn't touch any JoinCode row's useCount", async () => {
    const org = await makeOrg();
    const { row } = await makeJoinCode(org.id, { grantsRole: DbRole.EBOARD });
    await redeemJoinCodeForSignup({
      orgId: org.id,
      submittedCode: "",
      email: `nocode-usecount-${randomUUID()}@bison.howard.edu`,
      passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
      firstName: "Test",
      lastName: "User",
    });
    const fresh = await prisma.joinCode.findUniqueOrThrow({ where: { id: row.id } });
    expect(fresh.useCount).toBe(0);
  });

  it("a garbage code still fails — 'no code' only applies to a genuinely blank submission, EBOARD/ADMIN signup still requires and validates a real one", async () => {
    const org = await makeOrg();
    await makeJoinCode(org.id, { grantsRole: DbRole.EBOARD });
    await expect(
      redeemJoinCodeForSignup({
        orgId: org.id,
        submittedCode: "GARBAGE-CODE",
        email: `garbage-${randomUUID()}@bison.howard.edu`,
        passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
        firstName: "Test",
        lastName: "User",
      }),
    ).rejects.toMatchObject({ message: GENERIC_MESSAGE });
  });

  it("an EBOARD code entered claiming ADMIN still grants EBOARD — the matched code's role, not the picker's", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { grantsRole: DbRole.EBOARD });
    const result = await redeemJoinCodeForSignup({
      orgId: org.id,
      submittedCode: plaintext,
      email: `claimed-admin-eboard-code-${randomUUID()}@bison.howard.edu`,
      passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
      firstName: "Test",
      lastName: "User",
    });
    expect(result.grantsRole).toBe("eboard");
  });
});

describe("join code failure modes — indistinguishable from each other", () => {
  it("a wrong code fails with the generic message", async () => {
    const org = await makeOrg();
    await makeJoinCode(org.id);

    await expect(
      redeemJoinCodeForSignup({
        orgId: org.id,
        submittedCode: "NOT-THE-CODE",
        email: `wrong-${randomUUID()}@bison.howard.edu`,
        passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
        firstName: "Test",
        lastName: "User",
      }),
    ).rejects.toMatchObject({ message: GENERIC_MESSAGE });
  });

  it("an expired code fails with the identical generic message", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { expiresAt: new Date(Date.now() - 60_000) });

    expect(await matchJoinCode(org.id, plaintext)).toBeNull();
    await expect(
      redeemJoinCodeForSignup({
        orgId: org.id,
        submittedCode: plaintext,
        email: `expired-${randomUUID()}@bison.howard.edu`,
        passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
        firstName: "Test",
        lastName: "User",
      }),
    ).rejects.toMatchObject({ message: GENERIC_MESSAGE });
  });

  it("a deactivated code fails with the identical generic message", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { active: false });

    expect(await matchJoinCode(org.id, plaintext)).toBeNull();
    await expect(
      redeemJoinCodeForSignup({
        orgId: org.id,
        submittedCode: plaintext,
        email: `deactivated-${randomUUID()}@bison.howard.edu`,
        passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
        firstName: "Test",
        lastName: "User",
      }),
    ).rejects.toMatchObject({ message: GENERIC_MESSAGE });
  });

  it("an exhausted code fails with the identical generic message", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { maxUses: 1, useCount: 1 });

    expect(await matchJoinCode(org.id, plaintext)).toBeNull();
    await expect(
      redeemJoinCodeForSignup({
        orgId: org.id,
        submittedCode: plaintext,
        email: `exhausted-${randomUUID()}@bison.howard.edu`,
        passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
        firstName: "Test",
        lastName: "User",
      }),
    ).rejects.toMatchObject({ message: GENERIC_MESSAGE });
  });

  it("claims exactly one use under concurrent redemption of a maxUses:1 code", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { maxUses: 1 });

    const attempt = (email: string) =>
      redeemJoinCodeForSignup({
        orgId: org.id,
        submittedCode: plaintext,
        email,
        passwordHash: "irrelevant",
        firstName: "Test",
        lastName: "User",
      });

    const results = await Promise.allSettled([
      attempt(`race-a-${randomUUID()}@bison.howard.edu`),
      attempt(`race-b-${randomUUID()}@bison.howard.edu`),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ message: GENERIC_MESSAGE });

    const row = await prisma.joinCode.findFirstOrThrow({ where: { orgId: org.id } });
    expect(row.useCount).toBe(1);
  });
});

describe("guest join code — role-filtered redemption (Part 5)", () => {
  it("an ADMIN code is rejected at the guest gate", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { grantsRole: DbRole.ADMIN });
    expect(await redeemGuestJoinCode(org.id, plaintext)).toBeNull();
  });

  it("a GENERAL (member) code is also rejected at the guest gate — never hand the real member code to outsiders", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { grantsRole: DbRole.GENERAL });
    expect(await redeemGuestJoinCode(org.id, plaintext)).toBeNull();
  });

  it("a GUEST-granting code succeeds and claims a use", async () => {
    const org = await makeOrg();
    const { plaintext } = await makeJoinCode(org.id, { grantsRole: DbRole.GUEST });
    const label = await redeemGuestJoinCode(org.id, plaintext);
    expect(label).not.toBeNull();

    const row = await prisma.joinCode.findFirstOrThrow({ where: { orgId: org.id } });
    expect(row.useCount).toBe(1);
  });
});

describe("registerGuest — subject to the same check-in code gate as members", () => {
  it("a guest checking in with no code is rejected with BAD_CODE", async () => {
    const org = await makeOrg();
    const category = await makeCategory(org.id);
    const event = await prisma.event.create({
      data: {
        orgId: org.id,
        slug: `test-event-${randomUUID()}`,
        name: "Guest Code Gate Test Event",
        categoryId: category.id,
        date: new Date(),
        status: "SCHEDULED",
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      registerGuest({
        orgId: org.id,
        eventId: event.id,
        code: "000000",
        firstName: "Guest",
        lastName: "Visitor",
        email: `guest-badcode-${randomUUID()}@example.com`,
        affiliation: "",
        extra: {},
      }),
    ).rejects.toMatchObject({ code: "BAD_CODE" });
  });

  it("the correct current code succeeds for a guest", async () => {
    const org = await makeOrg();
    const category = await makeCategory(org.id);
    const event = await prisma.event.create({
      data: {
        orgId: org.id,
        slug: `test-event-${randomUUID()}`,
        name: "Guest Code Gate Success Event",
        categoryId: category.id,
        date: new Date(),
        status: "SCHEDULED",
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await registerGuest({
      orgId: org.id,
      eventId: event.id,
      code: currentCode(event.id, new Date()),
      firstName: "Guest",
      lastName: "Visitor",
      email: `guest-goodcode-${randomUUID()}@example.com`,
      affiliation: "",
      extra: {},
    });
    expect(result.pointsAwarded).toBe(0);
  });
});

describe("guest accounts can never sign in (Part 5)", () => {
  it("registerGuest creates a User with role GUEST and no passwordHash at all", async () => {
    const org = await makeOrg();
    const category = await makeCategory(org.id);
    const event = await prisma.event.create({
      data: {
        orgId: org.id,
        slug: `test-event-${randomUUID()}`,
        name: "Guest Test Event",
        categoryId: category.id,
        date: new Date(),
        status: "SCHEDULED",
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60_000),
      },
    });

    const email = `guest-${randomUUID()}@example.com`;
    await registerGuest({
      orgId: org.id,
      eventId: event.id,
      code: currentCode(event.id, new Date()),
      firstName: "Guest",
      lastName: "Visitor",
      email,
      affiliation: "Nearby University",
      extra: {},
    });

    const authRecord = await getAuthRecord(org.id, email);
    expect(authRecord).not.toBeNull();
    expect(authRecord!.role).toBe("guest");
    expect(authRecord!.passwordHash).toBeNull();

    // The exact condition lib/auth.ts authorize() checks before ever running
    // a bcrypt compare — verified here as the data-level invariant it relies
    // on (authorize() itself requires a live NextAuth request context to
    // exercise end-to-end).
    const wouldBeRejected = authRecord!.role === "guest" || authRecord!.passwordHash === null;
    expect(wouldBeRejected).toBe(true);

    // No hash means no password can ever match, for any input — belt and suspenders.
    expect(await verifyPassword("literally anything", authRecord!.passwordHash)).toBe(false);
  });

  it("a guest registering twice for the same event is blocked by the unique constraint", async () => {
    const org = await makeOrg();
    const category = await makeCategory(org.id);
    const event = await prisma.event.create({
      data: {
        orgId: org.id,
        slug: `test-event-${randomUUID()}`,
        name: "Dedupe Test Event",
        categoryId: category.id,
        date: new Date(),
        status: "SCHEDULED",
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60_000),
      },
    });
    const email = `dupe-guest-${randomUUID()}@example.com`;
    const input = {
      orgId: org.id,
      eventId: event.id,
      code: currentCode(event.id, new Date()),
      firstName: "Guest",
      lastName: "Visitor",
      email,
      affiliation: "",
      extra: {},
    };

    await registerGuest(input);
    await expect(registerGuest(input)).rejects.toBeInstanceOf(AppError);
  });

  it("a guest who later creates a real account keeps their prior registrations", async () => {
    const org = await makeOrg();
    const category = await makeCategory(org.id);
    const event = await prisma.event.create({
      data: {
        orgId: org.id,
        slug: `test-event-${randomUUID()}`,
        name: "Conversion Test Event",
        categoryId: category.id,
        date: new Date(),
        status: "SCHEDULED",
        opensAt: new Date(Date.now() - 60_000),
        closesAt: new Date(Date.now() + 60_000),
      },
    });
    const email = `converts-${randomUUID()}@bison.howard.edu`;
    await registerGuest({
      orgId: org.id,
      eventId: event.id,
      code: currentCode(event.id, new Date()),
      firstName: "Future",
      lastName: "Member",
      email,
      affiliation: "",
      extra: {},
    });

    const guestUser = await prisma.user.findUniqueOrThrow({ where: { orgId_email: { orgId: org.id, email } } });
    const registrationsBefore = await prisma.registration.count({ where: { userId: guestUser.id } });
    expect(registrationsBefore).toBe(1);

    const { plaintext } = await makeJoinCode(org.id, { grantsRole: DbRole.GENERAL });
    const result = await redeemJoinCodeForSignup({
      orgId: org.id,
      submittedCode: plaintext,
      email,
      passwordHash: await hashPassword("Sufficiently-Long-Password-1"),
      firstName: "Future",
      lastName: "Member",
    });

    expect(result.convertedFromGuest).toBe(true);
    expect(result.member.id).toBe(guestUser.id);

    const registrationsAfter = await prisma.registration.count({ where: { userId: guestUser.id } });
    expect(registrationsAfter).toBe(1);

    const promoted = await getAuthRecord(org.id, email);
    expect(promoted!.role).toBe("general");
    expect(promoted!.passwordHash).not.toBeNull();
  });
});
