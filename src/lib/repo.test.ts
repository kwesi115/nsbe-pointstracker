/**
 * Runs against the real Postgres instance at DATABASE_URL (see
 * vitest.setup.ts) — no mocking of Prisma. One Org is created once for the
 * whole file (these tests don't exercise cross-org behavior — see
 * repo.cross-org.test.ts for that — they just need *an* org to exist) with
 * its own Config.SEASON so currentSeason() below is real and stable. Every
 * test creates its own uniquely-named users/events (randomUUID-suffixed) so
 * it can't collide with seeded dev data or other tests, and cleans up
 * exactly what it created.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { currentCode } from "./code";
import type { CoreFormAnswers } from "./core-form";
import { AppError } from "./errors";
import { standingsCacheTag } from "./points";
import { hashPassword } from "./passwords";
import { prisma } from "./prisma";
import {
  awardGameBonus,
  calculateMonthlyChampions,
  canAccessFile,
  correctHouse,
  getAdminLog,
  getEboardBoardRows,
  getEboardStandings,
  getActivePermissions,
  getMemberById,
  getStandings,
  grantPermission,
  hasPermission,
  isLoginEmailAllowed,
  revokePermission,
  registerForEvent as registerForEventRaw,
  revokeDues,
  revokePointAward,
  createManualAward,
  getMemberSummaryLive,
  saveFormFields,
  setConfigValue,
  setDuesReported,
  setHouseAssignment,
  setMemberRole,
  setNationalReported,
  verifyDues,
  verifyHouse,
  verifyNational,
} from "./repo";
import { Audience, Role, UserStatus, EventStatus } from "@/generated/prisma/enums";

// Spied, not disabled — every mutation that can change the standings board
// calls invalidateStandings (see lib/repo.ts), which is exercised for real
// here (real tag string, real call sites) but doesn't need a real Next.js
// request scope to attach to, hence the mock rather than relying on
// invalidateStandings' own try/catch swallow.
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from "next/cache";
const revalidateTagMock = revalidateTag as unknown as ReturnType<typeof vi.fn>;

/**
 * Every test in this file predates the restored check-in code — rather than
 * thread a correct rotating code through 25+ call sites that were never
 * about codes in the first place, this wrapper fills in the current code for
 * `eventId` by default. Tests that ARE about the code (see "registerForEvent
 * — check-in code" below) call registerForEventRaw directly, or pass an
 * explicit `code` override here.
 */
function registerForEvent(
  input: Omit<Parameters<typeof registerForEventRaw>[0], "code"> & { code?: string },
) {
  return registerForEventRaw({
    ...input,
    code: input.code ?? currentCode(input.eventId, input.receivedAt ?? new Date()),
  });
}

const TEST_SEASON = "2026-2027";
let orgId: string;
/** category name (the old "type" string) -> EventCategory id, seeded once in beforeAll. */
let categoryIds: Record<string, string> = {};

beforeAll(async () => {
  const org = await prisma.org.create({
    data: { slug: `repo-test-${randomUUID()}`, name: "Repo Test Org", shortName: "RT" },
  });
  orgId = org.id;
  await prisma.config.create({ data: { orgId, key: "SEASON", value: TEST_SEASON } });
  // Only the three categories these tests actually create events under —
  // EBOARD_ONLY categories (E-Board Meeting/Retreat) score 0 on the member
  // board regardless, but DO carry eboardEligible for the internal track.
  const [gbm, eboardMeeting, retreat] = await Promise.all([
    prisma.eventCategory.create({
      data: { orgId, code: "GBM", name: "General Body Meeting", shortName: "GBM", tier: 1, memberPoints: 2, sortOrder: 0 },
    }),
    prisma.eventCategory.create({
      data: {
        orgId,
        code: "EBOARD_MEETING",
        name: "E-Board Meeting",
        shortName: "E-Board Mtg",
        tier: null,
        memberPoints: 0,
        eboardEligible: true,
        audience: Audience.EBOARD_ONLY,
        sortOrder: 1,
      },
    }),
    prisma.eventCategory.create({
      data: {
        orgId,
        code: "EBOARD_RETREAT",
        name: "Retreat",
        shortName: "Retreat",
        tier: null,
        memberPoints: 0,
        eboardEligible: true,
        audience: Audience.EBOARD_ONLY,
        sortOrder: 2,
      },
    }),
  ]);
  categoryIds = {
    "General Body Meeting": gbm.id,
    "E-Board Meeting": eboardMeeting.id,
    Retreat: retreat.id,
  };
});

afterAll(async () => {
  await prisma.adminLog.deleteMany({ where: { orgId } });
  await prisma.config.deleteMany({ where: { orgId } });
  await prisma.eventCategory.deleteMany({ where: { orgId } });
  await prisma.org.delete({ where: { id: orgId } });
});

/**
 * Self-contained regardless of whether Config.MAJORS_LIST/HOUSES_LIST are
 * seeded: "Other" is always a valid major, and declining a House assignment
 * never needs a configured House list or an uploaded file.
 */
function validCore(overrides: Partial<CoreFormAnswers> = {}): CoreFormAnswers {
  return {
    firstName: "Test",
    lastName: "User",
    studentId: "1234567",
    phone: "555-0100",
    personalEmail: "test-user@example.com",
    classification: "freshman",
    major: "Other",
    majorOther: "Undeclared",
    duesPaid: true,
    nationalMember: false,
    houseSkipped: true,
    ...overrides,
  };
}

let createdUserIds: string[] = [];
let createdEventIds: string[] = [];

afterEach(async () => {
  // PointAward.userId is onDelete: Restrict — awardGameBonus/calculateMonthlyChampions
  // tests must clear these before user deletion below can succeed.
  await prisma.pointAward.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.registration.deleteMany({
    where: { OR: [{ userId: { in: createdUserIds } }, { eventId: { in: createdEventIds } }] },
  });
  await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds = [];
  createdEventIds = [];
});

/** This file's own Config.SEASON, set once in beforeAll — real and stable, not the shared dev DB's. */
async function currentSeason(): Promise<string> {
  const row = await prisma.config.findUnique({ where: { orgId_key: { orgId, key: "SEASON" } } });
  return row?.value ?? "";
}

// Defaults to fully eligible (both self-reported, membershipSeason matching
// the real Config.SEASON, no *VerifiedAt at all) so tests about
// role/status/concurrency (unrelated to eligibility) aren't also implicitly
// testing isEligible — verification is audit-only now, see lib/points.ts.
async function makeUser(
  overrides: Partial<{
    role: Role;
    status: UserStatus;
    duesVerifiedAt: Date | null;
    nationalVerifiedAt: Date | null;
    duesPaidReported: boolean;
    nationalMemberReported: boolean;
    membershipSeason: string | null;
  }> = {},
) {
  const passwordHash = await hashPassword("irrelevant-test-password");
  const now = new Date();
  const membershipSeason = "membershipSeason" in overrides ? overrides.membershipSeason : await currentSeason();
  const user = await prisma.user.create({
    data: {
      orgId,
      email: `test-${randomUUID()}@bison.howard.edu`,
      passwordHash,
      firstName: "Test",
      lastName: "User",
      role: overrides.role ?? Role.GENERAL,
      status: overrides.status ?? UserStatus.ACTIVE,
      duesPaidReported: overrides.duesPaidReported ?? true,
      duesVerifiedAt: "duesVerifiedAt" in overrides ? overrides.duesVerifiedAt : now,
      nationalMemberReported: overrides.nationalMemberReported ?? true,
      nationalVerifiedAt: "nationalVerifiedAt" in overrides ? overrides.nationalVerifiedAt : now,
      membershipSeason,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeOpenEvent(
  overrides: Partial<{ type: string; audience: Audience; openedAt: Date | null }> = {},
) {
  const now = Date.now();
  const type = overrides.type ?? "General Body Meeting";
  const categoryId = categoryIds[type];
  if (!categoryId) throw new Error(`Unknown test category: ${type}`);
  const event = await prisma.event.create({
    data: {
      orgId,
      slug: `test-event-${randomUUID()}`,
      name: "Test Event",
      categoryId,
      date: new Date(now),
      status: EventStatus.SCHEDULED,
      opensAt: new Date(now - 60_000),
      closesAt: new Date(now + 60_000),
      audience: overrides.audience ?? Audience.ALL,
      openedAt: "openedAt" in overrides ? overrides.openedAt : new Date(now - 60_000),
    },
  });
  createdEventIds.push(event.id);
  return event;
}

describe("registerForEvent — concurrency", () => {
  it("two truly concurrent registrations for the same event+user: exactly one succeeds, the other gets ALREADY_REGISTERED", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();

    const [a, b] = await Promise.allSettled([
      registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} }),
      registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} }),
    ]);

    const results = [a, b];
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(AppError);
    expect((rejection.reason as AppError).code).toBe("ALREADY_REGISTERED");
    expect((rejection.reason as AppError).status).toBe(409);

    const registrations = await prisma.registration.findMany({ where: { eventId: event.id } });
    expect(registrations).toHaveLength(1);
  });

  it("a normal registration creates exactly one Registration row and awards points", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();

    const result = await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });
    expect(result.pointsAwarded).toBe(2); // General Body Meeting, from the real seeded PointSystem

    const registrations = await prisma.registration.findMany({ where: { eventId: event.id, userId: user.id } });
    expect(registrations).toHaveLength(1);
  });
});

describe("registerForEvent — check-in code (restored)", () => {
  it("the correct current code succeeds", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    const result = await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });
    expect(result.pointsAwarded).toBeGreaterThan(0);
  });

  it("a request with no code at all is rejected with BAD_CODE — the code is required again, not the sole-gate window it briefly was", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    await expect(
      registerForEventRaw({ orgId, email: user.email, eventId: event.id, code: "", core: validCore(), extra: {} }),
    ).rejects.toMatchObject({ code: "BAD_CODE", status: 403 });
  });

  it("a wrong code is rejected with BAD_CODE", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    await expect(
      registerForEvent({ orgId, email: user.email, eventId: event.id, code: "000000", core: validCore(), extra: {} }),
    ).rejects.toMatchObject({ code: "BAD_CODE", status: 403 });
  });

  it("a stale code is rejected even though /api/events/[id]/verify-code would have accepted it minutes ago — that endpoint gates the UI, this function is the actual boundary", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    // A code from several rotations ago — well past the "current or
    // previous step" grace window verifyCode allows.
    const staleCode = currentCode(event.id, new Date(Date.now() - 5 * 60_000));
    await expect(
      registerForEvent({ orgId, email: user.email, eventId: event.id, code: staleCode, core: validCore(), extra: {} }),
    ).rejects.toMatchObject({ code: "BAD_CODE" });
  });

  it("a code from a different event is rejected on this one", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    const otherEvent = await makeOpenEvent();
    await expect(
      registerForEvent({
        orgId,
        email: user.email,
        eventId: event.id,
        code: currentCode(otherEvent.id, new Date()),
        core: validCore(),
        extra: {},
      }),
    ).rejects.toMatchObject({ code: "BAD_CODE" });
  });

  it("isOpen is still checked before the code — an event that closed 2 seconds ago returns EVENT_CLOSED_DURING_SUBMIT, not BAD_CODE", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    await prisma.event.update({ where: { id: event.id }, data: { closesAt: new Date(Date.now() - 2000) } });

    await expect(
      registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} }),
    ).rejects.toMatchObject({ code: "EVENT_CLOSED_DURING_SUBMIT", status: 403 });
  });

  it("the duplicate check runs before answer validation — a second submission with garbage core data still reports ALREADY_REGISTERED, not VALIDATION_FAILED", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });

    await expect(
      registerForEvent({ orgId, email: user.email, eventId: event.id, core: {}, extra: {} }),
    ).rejects.toMatchObject({ code: "ALREADY_REGISTERED" });
  });
});

describe("registerForEvent — account status gate", () => {
  it("a PENDING user cannot register for an event", async () => {
    const user = await makeUser({ status: UserStatus.PENDING });
    const event = await makeOpenEvent();

    await expect(
      registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_ACTIVE",
      status: 403,
    });

    const registrations = await prisma.registration.findMany({ where: { eventId: event.id } });
    expect(registrations).toHaveLength(0);
  });

  it("a SUSPENDED user cannot register for an event", async () => {
    const user = await makeUser({ status: UserStatus.SUSPENDED });
    const event = await makeOpenEvent();

    await expect(
      registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_ACTIVE",
    });
  });
});

describe("role promotion and the leaderboard", () => {
  it("moves a member off the leaderboard immediately, without touching past registrations", async () => {
    const user = await makeUser({ role: Role.GENERAL });
    const event = await makeOpenEvent();
    await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });

    const before = await getStandings(orgId);
    expect(before.some((s) => s.email === user.email)).toBe(true);

    await setMemberRole(orgId, user.email, "eboard", "test-actor@bison.howard.edu");

    const after = await getStandings(orgId);
    expect(after.some((s) => s.email === user.email)).toBe(false);

    // The registration itself is untouched — roleAtTime stays frozen as an audit record.
    const registration = await prisma.registration.findFirst({ where: { userId: user.id, eventId: event.id } });
    expect(registration?.roleAtTime).toBe(Role.GENERAL);
  });
});

describe("registerForEvent — self-reported eligibility (Part 1)", () => {
  it("an ineligible member's registration records full pointsAwarded but is excluded from standings", async () => {
    const user = await makeUser({ duesPaidReported: false, membershipSeason: null });
    const event = await makeOpenEvent();

    const result = await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });
    expect(result.pointsAwarded).toBe(2);
    expect(result.eligible).toBe(false);

    const registration = await prisma.registration.findFirst({ where: { userId: user.id, eventId: event.id } });
    expect(registration?.pointsAwarded).toBe(2);
    expect(registration?.eligibleAtTime).toBe(false);

    const standings = await getStandings(orgId);
    expect(standings.some((s) => s.email === user.email)).toBe(false);
  });

  it("admin verification alone never puts a member on the leaderboard — self-reported flags are the only gate", async () => {
    const user = await makeUser({ duesPaidReported: false, nationalMemberReported: false, membershipSeason: null });
    const event = await makeOpenEvent();
    await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });

    await verifyDues(orgId, user.email, "test-actor@bison.howard.edu");
    await verifyNational(orgId, user.email, "test-actor@bison.howard.edu");

    const standings = await getStandings(orgId);
    expect(standings.some((s) => s.email === user.email)).toBe(false);
  });

  it("reporting Yes to both at check-in — no admin action — puts a member on the leaderboard with points from an earlier event, no backfill", async () => {
    const user = await makeUser({ duesPaidReported: false, nationalMemberReported: false, membershipSeason: null });
    const event = await makeOpenEvent();
    await registerForEvent({
      orgId,
      email: user.email,
      eventId: event.id,
      core: validCore({ duesPaid: false }),
      extra: {},
    });

    const before = await getStandings(orgId);
    expect(before.some((s) => s.email === user.email)).toBe(false);

    // A later check-in (different event) is when they finally report Yes to both.
    const laterEvent = await makeOpenEvent();
    await registerForEvent({
      orgId,
      email: user.email,
      eventId: laterEvent.id,
      core: validCore({ duesPaid: true, nationalMember: true }),
      extra: {},
    });

    const after = await getStandings(orgId);
    const row = after.find((s) => s.email === user.email);
    // Both registrations' points count — the first one was never rewritten.
    expect(row?.points).toBe(4);

    const firstRegistration = await prisma.registration.findFirst({ where: { userId: user.id, eventId: event.id } });
    expect(firstRegistration?.pointsAwarded).toBe(2); // untouched
  });

  it("answering No leaves the question re-armed; answering Yes writes duesPaidReported and stamps membershipSeason, and the next check-in doesn't ask again", async () => {
    const user = await makeUser({ duesPaidReported: false, membershipSeason: null });
    const eventA = await makeOpenEvent();
    await registerForEvent({
      orgId,
      email: user.email,
      eventId: eventA.id,
      core: validCore({ duesPaid: false }),
      extra: {},
    });

    const afterNo = await prisma.user.findUnique({ where: { id: user.id } });
    expect(afterNo?.duesPaidReported).toBe(false);
    expect(afterNo?.membershipSeason).toBeNull(); // "No" never stamps the season

    const eventB = await makeOpenEvent();
    await registerForEvent({
      orgId,
      email: user.email,
      eventId: eventB.id,
      core: validCore({ duesPaid: true }),
      extra: {},
    });

    const afterYes = await prisma.user.findUnique({ where: { id: user.id } });
    expect(afterYes?.duesPaidReported).toBe(true);
    expect(afterYes?.membershipSeason).toBe(await currentSeason());

    // A third check-in doesn't resupply duesPaid at all (already reported this season) — the existing value survives untouched.
    const eventC = await makeOpenEvent();
    const coreWithoutDues = validCore();
    delete (coreWithoutDues as { duesPaid?: boolean }).duesPaid;
    await registerForEvent({ orgId, email: user.email, eventId: eventC.id, core: coreWithoutDues, extra: {} });

    const stillReported = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillReported?.duesPaidReported).toBe(true);
  });

  it("setDuesReported/setNationalReported from /account produce the same DB state as answering at check-in", async () => {
    const user = await makeUser({ duesPaidReported: false, nationalMemberReported: false, membershipSeason: null });

    await setDuesReported(orgId, user.email, true, user.email);
    await setNationalReported(orgId, user.email, true, user.email);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.duesPaidReported).toBe(true);
    expect(row?.nationalMemberReported).toBe(true);
    expect(row?.membershipSeason).toBe(await currentSeason());

    const member = await getMemberById(orgId, user.id);
    expect(member).not.toBeNull();
  });

  it("the NSBE Membership ID survives answering No — at check-in and from /account", async () => {
    const user = await makeUser({ duesPaidReported: false, nationalMemberReported: false, membershipSeason: null });

    // Reported No, with an ID from a prior year supplied alongside it.
    await setNationalReported(orgId, user.email, false, user.email, "99999");
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.nsbeMembershipId).toBe("99999");

    // Answering No again at check-in doesn't wipe it either.
    const event = await makeOpenEvent();
    await registerForEvent({
      orgId,
      email: user.email,
      eventId: event.id,
      core: validCore({ nationalMember: false, nsbeMembershipId: "99999" }),
      extra: {},
    });
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.nsbeMembershipId).toBe("99999");

    // Reporting No from /account with no ID supplied leaves the stored one alone.
    await setNationalReported(orgId, user.email, false, user.email);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.nsbeMembershipId).toBe("99999");

    // Only clearing the field clears the value.
    await setNationalReported(orgId, user.email, true, user.email, "");
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.nsbeMembershipId).toBeNull();
  });

  it("revoking a claim requires a note, drops the member from the leaderboard, and re-arms the question", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });

    const before = await getStandings(orgId);
    expect(before.some((s) => s.email === user.email)).toBe(true);

    await revokeDues(orgId, user.email, "test-actor@bison.howard.edu", "Payment record doesn't show this member");

    const after = await getStandings(orgId);
    expect(after.some((s) => s.email === user.email)).toBe(false);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.duesPaidReported).toBe(false);
    expect(row?.duesRevokedNote).toBe("Payment record doesn't show this member");
    expect(row?.duesRevokedAt).not.toBeNull();

    // Points are still there, just filtered — no backfill needed if they report again.
    const registration = await prisma.registration.findFirst({ where: { userId: user.id, eventId: event.id } });
    expect(registration?.pointsAwarded).toBe(2);
  });

  it("a stale membershipSeason (season rollover) makes a previously-eligible member ineligible and re-arms both questions", async () => {
    const season = await currentSeason();
    const user = await makeUser({ membershipSeason: "2020-2021" }); // an old season, both flags still true
    const event = await makeOpenEvent();

    const before = await getStandings(orgId);
    expect(before.some((s) => s.email === user.email)).toBe(false); // stale season already fails isEligible

    // The check-in form re-asks (duesAlreadyReported is false for a stale season) — answering Yes again re-stamps the current season.
    await registerForEvent({
      orgId,
      email: user.email,
      eventId: event.id,
      core: validCore({ duesPaid: true, nationalMember: true }),
      extra: {},
    });

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.membershipSeason).toBe(season);

    const after = await getStandings(orgId);
    expect(after.some((s) => s.email === user.email)).toBe(true);
  });
});

describe("canAccessFile — GET /api/files/[id] authorization (Part 4)", () => {
  it("the owner can access their own file; a non-owner non-admin gets a 404 (not 403)", () => {
    const file = { ownerEmail: "owner@bison.howard.edu" };
    expect(canAccessFile(file, { email: "owner@bison.howard.edu", role: "general" })).toBe(true);
    expect(canAccessFile(file, { email: "someone-else@bison.howard.edu", role: "general" })).toBe(false);
  });

  it("an EBOARD member can access anyone's file", () => {
    const file = { ownerEmail: "owner@bison.howard.edu" };
    expect(canAccessFile(file, { email: "eboard@bison.howard.edu", role: "eboard" })).toBe(true);
  });

  it("an ADMIN member can access anyone's file", () => {
    const file = { ownerEmail: "owner@bison.howard.edu" };
    expect(canAccessFile(file, { email: "admin@bison.howard.edu", role: "admin" })).toBe(true);
  });
});

describe("registerForEvent — E-Board track (Part 3/5/6)", () => {
  it("an EBOARD user attending an ALL-audience event produces one Registration, scoring 0 on the member board and eboardPointsAwarded 1 in the response", async () => {
    const officer = await makeUser({ role: Role.EBOARD });
    const event = await makeOpenEvent(); // ALL-audience GBM — Part 6 only reduces EBOARD_ONLY events, so this still takes the full core form.

    const result = await registerForEvent({
      orgId,
      email: officer.email,
      eventId: event.id,
      core: { ...validCore(), firstName: officer.firstName, lastName: officer.lastName },
      extra: {},
    });

    expect(result.pointsAwarded).toBe(0); // awardFor: only role "general" earns member points
    expect(result.eboardPointsAwarded).toBe(1);

    const registrations = await prisma.registration.findMany({ where: { eventId: event.id, userId: officer.id } });
    expect(registrations).toHaveLength(1);
    expect(registrations[0].pointsAwarded).toBe(0);
  });

  it("an EBOARD_ONLY event is FORBIDDEN for a GENERAL user, and its registrations never appear on the member board", async () => {
    const officer = await makeUser({ role: Role.EBOARD });
    const member = await makeUser({ role: Role.GENERAL });
    const event = await makeOpenEvent({ type: "E-Board Meeting", audience: Audience.EBOARD_ONLY });

    await expect(
      registerForEvent({
        orgId,
        email: member.email,
        eventId: event.id,
        core: { firstName: "A", lastName: "B" },
        extra: {},
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    const result = await registerForEvent({
      orgId,
      email: officer.email,
      eventId: event.id,
      core: { firstName: officer.firstName, lastName: officer.lastName },
      extra: {},
    });
    expect(result.eboardPointsAwarded).toBe(1);

    const standings = await getStandings(orgId);
    expect(standings.some((s) => s.email === officer.email)).toBe(false);
  });

  it("the reduced core form leaves classification/major/dues/national snapshot columns null, but still stamps coreFormVersion", async () => {
    const officer = await makeUser({ role: Role.EBOARD });
    const event = await makeOpenEvent({ type: "Retreat", audience: Audience.EBOARD_ONLY });

    await registerForEvent({
      orgId,
      email: officer.email,
      eventId: event.id,
      core: { firstName: "Reduced", lastName: "Form" },
      extra: {},
    });

    const registration = await prisma.registration.findFirst({ where: { eventId: event.id, userId: officer.id } });
    expect(registration?.classificationAtTime).toBeNull();
    expect(registration?.majorAtTime).toBeNull();
    expect(registration?.duesReportedAtTime).toBeNull();
    expect(registration?.nationalReportedAtTime).toBeNull();
    expect(registration?.eligibleAtTime).toBeNull();
    expect(registration?.coreFormVersion).not.toBeNull();

    const updatedUser = await prisma.user.findUnique({ where: { id: officer.id } });
    expect(updatedUser?.firstName).toBe("Reduced");
    expect(updatedUser?.lastName).toBe("Form");
  });
});

describe("promotion/demotion move a member between the two boards with no backfill (Part 2)", () => {
  it("promoting a GENERAL member with existing history retroactively pulls it onto the internal board; demoting reverses it", async () => {
    const user = await makeUser({ role: Role.GENERAL });
    const event = await makeOpenEvent(); // ALL-audience GBM, countsForEboard defaults true
    await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });

    const beforePromotion = await getEboardStandings(orgId);
    expect(beforePromotion.some((s) => s.email === user.email)).toBe(false);

    await setMemberRole(orgId, user.email, "eboard", "test-actor@bison.howard.edu");

    const afterPromotion = await getEboardStandings(orgId);
    const row = afterPromotion.find((s) => s.email === user.email);
    expect(row?.points).toBe(1); // the OLD general-era GBM registration now counts — no new write to it
    expect(row?.events).toBe(1);

    await setMemberRole(orgId, user.email, "general", "test-actor@bison.howard.edu");
    const afterDemotion = await getEboardStandings(orgId);
    expect(afterDemotion.some((s) => s.email === user.email)).toBe(false);
  });
});

describe("getEboardBoardRows — category breakdown (Part 4)", () => {
  it("buckets by event.type into chapter/eboardMeetings/retreats and computes an attendance rate", async () => {
    const officer = await makeUser({ role: Role.EBOARD });
    const gbm = await makeOpenEvent({ type: "General Body Meeting" });
    const meeting = await makeOpenEvent({ type: "E-Board Meeting", audience: Audience.EBOARD_ONLY });

    await registerForEvent({
      orgId,
      email: officer.email,
      eventId: gbm.id,
      core: { ...validCore(), firstName: officer.firstName, lastName: officer.lastName },
      extra: {},
    });
    await registerForEvent({
      orgId,
      email: officer.email,
      eventId: meeting.id,
      core: { firstName: officer.firstName, lastName: officer.lastName },
      extra: {},
    });

    const rows = await getEboardBoardRows(orgId);
    const row = rows.find((r) => r.email === officer.email);
    expect(row?.chapter.attended).toBeGreaterThanOrEqual(1);
    expect(row?.eboardMeetings.attended).toBeGreaterThanOrEqual(1);
    expect(row?.eboardMeetings.eligible).toBeGreaterThanOrEqual(row?.eboardMeetings.attended ?? 0);
  });
});

describe("saveFormFields — extra-question cap (Part 6)", () => {
  it("rejects more than 5 extra questions, server-side, regardless of caller", async () => {
    const admin = await makeUser({ role: Role.EBOARD });
    const event = await makeOpenEvent();

    const fields = Array.from({ length: 6 }, (_, i) => ({
      fieldKey: `q${i}`,
      label: `Question ${i}`,
      type: "short_text" as const,
      required: false,
      options: [],
      helpText: "",
      order: i,
      prefill: "",
    }));

    await expect(saveFormFields({ orgId, eventId: event.id, fields, actor: admin.email })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("awardGameBonus — the +1-per-member-per-event cap (Part 3)", () => {
  it("a second game bonus for the same member and event is rejected by the unique constraint", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();

    const first = await awardGameBonus(orgId, event.id, [user.email], 1, "Trivia winner", "test-actor@bison.howard.edu");
    expect(first.awarded).toEqual([user.email]);
    expect(first.skipped).toEqual([]);

    const second = await awardGameBonus(orgId, event.id, [user.email], 1, "Trivia winner (again)", "test-actor@bison.howard.edu");
    expect(second.awarded).toEqual([]);
    expect(second.skipped).toEqual([user.email]);

    const awards = await prisma.pointAward.findMany({ where: { orgId, userId: user.id, eventId: event.id } });
    expect(awards).toHaveLength(1);
  });
});

describe("calculateMonthlyChampions — idempotent materialization (Part 3)", () => {
  it("a three-way tie for the max awards +5 to all three, and recalculating the same set is idempotent", async () => {
    const closesAt = new Date("2026-03-15T20:00:00-05:00");
    const month = "2026-03";
    const now = new Date("2026-04-01T00:00:00-05:00"); // the month is over

    const [a, b, c, low] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);

    for (const user of [a, b, c]) {
      for (let i = 0; i < 3; i++) {
        const event = await makeOpenEvent();
        // Register while the window is genuinely open, THEN backdate closesAt
        // into the target month — registerForEvent itself checks isOpen()
        // against the real clock, which would reject an already-past window.
        await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });
        await prisma.event.update({ where: { id: event.id }, data: { closesAt } });
      }
    }
    const lowEvent = await makeOpenEvent();
    await registerForEvent({ orgId, email: low.email, eventId: lowEvent.id, core: validCore(), extra: {} });
    await prisma.event.update({ where: { id: lowEvent.id }, data: { closesAt } });

    const result = await calculateMonthlyChampions(orgId, month, 5, "test-actor@bison.howard.edu", now);
    expect(result.awarded.slice().sort()).toEqual([a.email, b.email, c.email].sort());
    expect(result.unchanged).toBe(false);

    const again = await calculateMonthlyChampions(orgId, month, 5, "test-actor@bison.howard.edu", now);
    expect(again.awarded).toEqual([]);
    expect(again.revoked).toEqual([]);
    expect(again.unchanged).toBe(true);

    const awards = await prisma.pointAward.findMany({ where: { orgId, kind: "MONTHLY_CHAMPION", periodMonth: month } });
    expect(awards).toHaveLength(3);
  });

  it("a member below MONTHLY_CHAMPION_MIN_EVENTS (default 2) is not champion even as the sole attendee", async () => {
    const closesAt = new Date("2026-05-10T20:00:00-05:00");
    const month = "2026-05";
    const now = new Date("2026-06-01T00:00:00-05:00");

    const user = await makeUser();
    const event = await makeOpenEvent();
    await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });
    await prisma.event.update({ where: { id: event.id }, data: { closesAt } });

    const result = await calculateMonthlyChampions(orgId, month, 5, "test-actor@bison.howard.edu", now);
    expect(result.awarded).toEqual([]);
  });
});

describe("setHouseAssignment / correctHouse — verified House lock (Part 5/6)", () => {
  it("an unverified member can set and change their House via setHouseAssignment", async () => {
    const user = await makeUser();
    await setHouseAssignment(orgId, user.email, "House Turing", "file_1", user.email);
    let row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.house).toBe("House Turing");
    expect(row.houseVerifiedAt).toBeNull();

    await setHouseAssignment(orgId, user.email, "House Hamilton", "file_2", user.email);
    row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.house).toBe("House Hamilton");
  });

  it("a member with a verified House cannot change it via setHouseAssignment (a direct member-facing call) — rejects with FORBIDDEN", async () => {
    const user = await makeUser();
    await setHouseAssignment(orgId, user.email, "House Turing", "file_1", user.email);
    await verifyHouse(orgId, user.email, "admin@bison.howard.edu");

    await expect(setHouseAssignment(orgId, user.email, "House Hamilton", "file_2", user.email)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.house).toBe("House Turing");
  });

  it("an admin can change a verified House via correctHouse, and the change is logged with the note", async () => {
    const user = await makeUser();
    await setHouseAssignment(orgId, user.email, "House Turing", "file_1", user.email);
    await verifyHouse(orgId, user.email, "admin@bison.howard.edu");

    await correctHouse(orgId, user.email, "House Hamilton", "member picked the wrong House at signup", "admin@bison.howard.edu");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.house).toBe("House Hamilton");
    expect(row.houseVerifiedAt).not.toBeNull();

    const log = await getAdminLog(orgId);
    const entry = log.find((l) => l.action === "correct_house" && l.target === user.email);
    expect(entry).toBeDefined();
    expect(entry!.detail).toContain("House Hamilton");
    expect(entry!.detail).toContain("member picked the wrong House at signup");
  });
});

describe("setMemberRole — last-ADMIN protection", () => {
  it("blocks demoting the org's only ADMIN", async () => {
    const admin = await makeUser({ role: Role.ADMIN });

    await expect(setMemberRole(orgId, admin.email, "eboard", "test-actor@bison.howard.edu")).rejects.toMatchObject({
      code: "LAST_ADMIN",
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row.role).toBe(Role.ADMIN);
  });

  it("allows demoting an ADMIN when another ADMIN remains", async () => {
    const admin1 = await makeUser({ role: Role.ADMIN });
    const admin2 = await makeUser({ role: Role.ADMIN });

    await setMemberRole(orgId, admin1.email, "eboard", "test-actor@bison.howard.edu");

    const demoted = await prisma.user.findUniqueOrThrow({ where: { id: admin1.id } });
    expect(demoted.role).toBe(Role.EBOARD);
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: admin2.id } });
    expect(untouched.role).toBe(Role.ADMIN);
  });

  it("never blocks promoting a member TO admin", async () => {
    const user = await makeUser({ role: Role.GENERAL });
    const promoted = await setMemberRole(orgId, user.email, "admin", "test-actor@bison.howard.edu");
    expect(promoted.role).toBe("admin");
  });
});

describe("isLoginEmailAllowed — login-time domain/allowlist gate (Config.ADMIN_EMAIL_ALLOWLIST)", () => {
  afterEach(async () => {
    await prisma.config.deleteMany({ where: { orgId, key: { in: ["ALLOWED_EMAIL_DOMAIN", "ADMIN_EMAIL_ALLOWLIST"] } } });
  });

  it("allows any email when no domain is configured", async () => {
    expect(await isLoginEmailAllowed(orgId, "anyone@example.com")).toBe(true);
  });

  it("allows an email matching the configured domain", async () => {
    await setConfigValue(orgId, "ALLOWED_EMAIL_DOMAIN", "bison.howard.edu", "test-actor@bison.howard.edu");
    expect(await isLoginEmailAllowed(orgId, "student@bison.howard.edu")).toBe(true);
  });

  it("rejects a non-matching, non-allowlisted email", async () => {
    await setConfigValue(orgId, "ALLOWED_EMAIL_DOMAIN", "bison.howard.edu", "test-actor@bison.howard.edu");
    expect(await isLoginEmailAllowed(orgId, "someone@gmail.com")).toBe(false);
  });

  it("allows a non-matching email that appears in the allowlist, and only that email", async () => {
    await setConfigValue(orgId, "ALLOWED_EMAIL_DOMAIN", "bison.howard.edu", "test-actor@bison.howard.edu");
    await setConfigValue(
      orgId,
      "ADMIN_EMAIL_ALLOWLIST",
      "hunsbepres@gmail.com|nsbevphu@gmail.com",
      "test-actor@bison.howard.edu",
    );
    expect(await isLoginEmailAllowed(orgId, "hunsbepres@gmail.com")).toBe(true);
    expect(await isLoginEmailAllowed(orgId, "someone-else@gmail.com")).toBe(false);
  });

  it("is case-insensitive on both the submitted email and the stored allowlist", async () => {
    await setConfigValue(orgId, "ALLOWED_EMAIL_DOMAIN", "bison.howard.edu", "test-actor@bison.howard.edu");
    await setConfigValue(orgId, "ADMIN_EMAIL_ALLOWLIST", "hunsbepres@gmail.com", "test-actor@bison.howard.edu");
    expect(await isLoginEmailAllowed(orgId, "HunsbePres@Gmail.com")).toBe(true);
  });
});

describe("standings cache invalidation — every mutation that can change the board calls invalidateStandings", () => {
  afterEach(() => {
    revalidateTagMock.mockClear();
  });

  it("a registration invalidates the standings cache", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();

    await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });

    const expectedTag = standingsCacheTag(orgId, await currentSeason());
    expect(revalidateTagMock).toHaveBeenCalledWith(expectedTag, { expire: 0 });
  });

  it("revoking a PointAward invalidates the standings cache", async () => {
    const user = await makeUser();
    const award = await createManualAward({ orgId, email: user.email, points: 3, reason: "test", actor: "test-actor@bison.howard.edu" });
    revalidateTagMock.mockClear(); // createManualAward itself also invalidates — isolate the revoke call.

    await revokePointAward(orgId, award.id, "test-actor@bison.howard.edu", "test revoke");

    const expectedTag = standingsCacheTag(orgId, await currentSeason());
    expect(revalidateTagMock).toHaveBeenCalledWith(expectedTag, { expire: 0 });
  });

  it("a role change invalidates the standings cache", async () => {
    const user = await makeUser();
    revalidateTagMock.mockClear();

    await setMemberRole(orgId, user.email, "eboard", "test-actor@bison.howard.edu");

    const expectedTag = standingsCacheTag(orgId, await currentSeason());
    expect(revalidateTagMock).toHaveBeenCalledWith(expectedTag, { expire: 0 });
  });

  it("revoking dues invalidates the standings cache", async () => {
    const user = await makeUser();
    revalidateTagMock.mockClear();

    await revokeDues(orgId, user.email, "test-actor@bison.howard.edu", "test revoke");

    const expectedTag = standingsCacheTag(orgId, await currentSeason());
    expect(revalidateTagMock).toHaveBeenCalledWith(expectedTag, { expire: 0 });
  });
});

describe("getMemberSummaryLive — the dashboard's own-row query never waits on the standings cache", () => {
  it("reflects a just-created registration immediately, even against an empty (stale) cached board", async () => {
    const user = await makeUser();
    const event = await makeOpenEvent();
    await registerForEvent({ orgId, email: user.email, eventId: event.id, core: validCore(), extra: {} });

    // Deliberately pass an empty/stale cached board — a real 30s-old cache
    // read wouldn't know about the registration that just happened above.
    const summary = await getMemberSummaryLive(orgId, user.email, await currentSeason(), []);

    expect(summary.points).toBeGreaterThan(0);
    expect(summary.rank).toBe(1);
  });

  it("returns a null rank for an ineligible member, without throwing", async () => {
    const user = await makeUser({ duesPaidReported: false, nationalMemberReported: false, membershipSeason: null });

    const summary = await getMemberSummaryLive(orgId, user.email, await currentSeason(), []);

    expect(summary.points).toBe(0);
    expect(summary.rank).toBeNull();
  });
});

describe("permission grants — the permissions engine", () => {
  it("hasPermission is false before any grant, true after granting, and false again after revoking", async () => {
    const admin = await makeUser({ role: Role.ADMIN });
    const member = await makeUser({ role: Role.GENERAL });

    expect(await hasPermission(orgId, member.email, "verifications_write")).toBe(false);

    await grantPermission(orgId, member.email, "verifications_write", admin.email);
    expect(await hasPermission(orgId, member.email, "verifications_write")).toBe(true);

    await revokePermission(orgId, member.email, "verifications_write", admin.email);
    expect(await hasPermission(orgId, member.email, "verifications_write")).toBe(false);
  });

  it("re-granting after a revoke reuses the same row (one row per orgId/userId/permission, not a second one)", async () => {
    const admin = await makeUser({ role: Role.ADMIN });
    const member = await makeUser({ role: Role.GENERAL });

    await grantPermission(orgId, member.email, "verifications_write", admin.email);
    await revokePermission(orgId, member.email, "verifications_write", admin.email);
    await grantPermission(orgId, member.email, "verifications_write", admin.email);

    const rows = await prisma.permissionGrant.findMany({ where: { orgId, userId: member.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
  });

  it("getActivePermissions lists only currently-active grants", async () => {
    const admin = await makeUser({ role: Role.ADMIN });
    const member = await makeUser({ role: Role.GENERAL });

    expect(await getActivePermissions(orgId, member.email)).toEqual([]);
    await grantPermission(orgId, member.email, "verifications_write", admin.email);
    expect(await getActivePermissions(orgId, member.email)).toEqual(["verifications_write"]);
    await revokePermission(orgId, member.email, "verifications_write", admin.email);
    expect(await getActivePermissions(orgId, member.email)).toEqual([]);
  });

  it("revoking a permission that was never granted is a no-op, not an error", async () => {
    const admin = await makeUser({ role: Role.ADMIN });
    const member = await makeUser({ role: Role.GENERAL });

    await expect(revokePermission(orgId, member.email, "verifications_write", admin.email)).resolves.toBeUndefined();
    expect(await hasPermission(orgId, member.email, "verifications_write")).toBe(false);
  });

  it("granting/revoking writes an AdminLog entry attributing the actor", async () => {
    const admin = await makeUser({ role: Role.ADMIN });
    const member = await makeUser({ role: Role.GENERAL });

    await grantPermission(orgId, member.email, "verifications_write", admin.email);
    await revokePermission(orgId, member.email, "verifications_write", admin.email);

    const log = await getAdminLog(orgId);
    const granted = log.find((l) => l.action === "grant_permission" && l.target === member.email);
    const revoked = log.find((l) => l.action === "revoke_permission" && l.target === member.email);
    expect(granted?.actor).toBe(admin.email);
    expect(revoked?.actor).toBe(admin.email);
  });

  it("grantPermission throws NOT_FOUND for an email with no account in this org", async () => {
    const admin = await makeUser({ role: Role.ADMIN });
    await expect(
      grantPermission(orgId, `nobody-${randomUUID()}@bison.howard.edu`, "verifications_write", admin.email),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a deleted user's grant row is gone too (PermissionGrant.userId cascades)", async () => {
    const admin = await makeUser({ role: Role.ADMIN });
    const member = await makeUser({ role: Role.GENERAL });
    await grantPermission(orgId, member.email, "verifications_write", admin.email);

    await prisma.user.delete({ where: { id: member.id } });
    createdUserIds = createdUserIds.filter((id) => id !== member.id); // already deleted — afterEach shouldn't try again

    const rows = await prisma.permissionGrant.findMany({ where: { orgId, userId: member.id } });
    expect(rows).toHaveLength(0);
  });
});
