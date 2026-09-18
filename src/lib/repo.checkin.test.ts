/**
 * The check-in submit path end to end — registerForEvent against the real
 * Postgres at DATABASE_URL — for every profile state that used to fail a
 * check-in on a field the member was never shown. checkin-plan.test.ts pins
 * the same rules down without a database.
 */

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Audience, EventStatus, Role } from "@/generated/prisma/enums";
import { createTestOrg, makeMember, makeOpenEvent, TEST_SEASON, type TestOrg } from "@/test/db-fixtures";
import { currentCode } from "./code";
import { AppError } from "./errors";
import { prisma } from "./prisma";
import { registerForEvent } from "./repo";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

let org: TestOrg;
let orgId: string;

beforeAll(async () => {
  org = await createTestOrg("checkin");
  orgId = org.orgId;
  await prisma.config.create({ data: { orgId, key: "MAJORS_LIST", value: "Computer Science|Biology" } });
});

afterAll(async () => {
  await org.cleanup();
});

afterEach(() => vi.restoreAllMocks());

/** A member with nothing left to answer — the one-tap check-in — plus whatever the test overrides. */
async function completeMember(overrides: Record<string, unknown> = {}, role: Role = Role.GENERAL) {
  const user = await makeMember(orgId, { role });
  return prisma.user.update({
    where: { id: user.id },
    data: {
      studentId: "00123456",
      phone: "555-0100",
      personalEmail: "member@gmail.com",
      tshirtSize: "M",
      classification: "JUNIOR",
      major: "Computer Science",
      profileSeason: TEST_SEASON,
      house: "House Turing",
      houseVerifiedAt: new Date(),
      resumeFileId: "file_on_record",
      ...overrides,
    },
  });
}

async function checkIn(
  user: { email: string },
  eventId: string,
  core: Record<string, unknown>,
  rendered: unknown[] | null,
) {
  return registerForEvent({ orgId, email: user.email, eventId, code: currentCode(eventId, new Date()), core, extra: {}, rendered });
}

async function registered(userId: string, eventId: string) {
  return (await prisma.registration.count({ where: { userId, eventId } })) === 1;
}

function silenceLogs() {
  return {
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

describe("profiles that used to 422 on a field the member never saw", () => {
  it("a free-text major from an earlier 'Other' check-in: one-tap check-in succeeds and the major is untouched", async () => {
    const user = await completeMember({ major: "Astrophysics", majorOther: "Astrophysics" });
    const event = await makeOpenEvent(orgId, org.gbmCategoryId);
    await checkIn(user, event.id, {}, []);
    expect(await registered(user.id, event.id)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).major).toBe("Astrophysics");
  });

  it("an older client still sending the whole seeded profile (no `rendered`) also succeeds", async () => {
    const user = await completeMember({ major: "Astrophysics", personalEmail: "member@gmail" });
    const event = await makeOpenEvent(orgId, org.gbmCategoryId);
    await checkIn(
      user,
      event.id,
      { firstName: user.firstName, lastName: user.lastName, studentId: "00123456", phone: "555-0100", personalEmail: "member@gmail", classification: "junior", major: "Astrophysics" },
      null,
    );
    expect(await registered(user.id, event.id)).toBe(true);
  });

  it("an ADMIN with no student ID on file checks in", async () => {
    const admin = await completeMember({ studentId: null }, Role.ADMIN);
    const event = await makeOpenEvent(orgId, org.gbmCategoryId);
    await checkIn(admin, event.id, {}, []);
    expect(await registered(admin.id, event.id)).toBe(true);
  });
});

describe("required, but not rendered", () => {
  it("dues revoked between page load and submit: the check-in goes through, nothing is written for dues, and it's logged loudly", async () => {
    const { error } = silenceLogs();
    const user = await completeMember({ duesPaidReported: true, nationalMemberReported: true, membershipSeason: TEST_SEASON });
    const event = await makeOpenEvent(orgId, org.gbmCategoryId);
    // The page rendered nothing; an admin revoked dues before the member hit Check in.
    await prisma.user.update({ where: { id: user.id }, data: { duesPaidReported: false } });

    await checkIn(user, event.id, {}, []);

    expect(await registered(user.id, event.id)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).duesPaidReported).toBe(false);
    const logged = error.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(logged).toContainEqual(
      expect.objectContaining({ event: "checkin_required_field_not_rendered", userId: user.id, fields: ["duesPaid"] }),
    );
  });
});

describe("an EBOARD member at an EBOARD_ONLY event", () => {
  it("is not validated against membership, House, or resume — even with none on file, even if a client sends them", async () => {
    const officer = await completeMember(
      { duesPaidReported: null, nationalMemberReported: null, membershipSeason: null, house: null, houseVerifiedAt: null, resumeFileId: null },
      Role.EBOARD,
    );
    const now = Date.now();
    const meeting = await prisma.event.create({
      data: {
        orgId,
        slug: `eboard-${randomUUID()}`,
        name: "E-Board meeting",
        categoryId: org.gbmCategoryId,
        audience: Audience.EBOARD_ONLY,
        date: new Date(now),
        status: EventStatus.SCHEDULED,
        opensAt: new Date(now - 60_000),
        closesAt: new Date(now + 60 * 60_000),
        openedAt: new Date(now - 60_000),
      },
    });
    await checkIn(officer, meeting.id, { duesPaid: "garbage", house: "House Nope", resumeAction: "upload" }, ["duesPaid", "house", "resume"]);
    expect(await registered(officer.id, meeting.id)).toBe(true);
  });
});

describe("real errors still stop a check-in — on a field that's on screen", () => {
  it("major = Other with an empty majorOther is rejected on majorOther", async () => {
    silenceLogs();
    const user = await completeMember({ profileSeason: "2025-2026" });
    const event = await makeOpenEvent(orgId, org.gbmCategoryId);
    const attempt = checkIn(user, event.id, { classification: "junior", major: "Other", majorOther: "" }, [
      "classification",
      "major",
      "majorOther",
      "nsbeMembershipId",
    ]);
    await expect(attempt).rejects.toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: { majorOther: "Tell us your major" } });
    expect(await registered(user.id, event.id)).toBe(false);
  });

  it("a blank NSBE Membership ID never blocks", async () => {
    const user = await completeMember({ nsbeMembershipId: "12345" });
    const event = await makeOpenEvent(orgId, org.gbmCategoryId);
    await checkIn(user, event.id, { nsbeMembershipId: "" }, ["nsbeMembershipId"]);
    expect(await registered(user.id, event.id)).toBe(true);
  });

  it("every 422 is logged with the userId, the fieldErrors and what the client rendered", async () => {
    const { warn } = silenceLogs();
    const user = await completeMember({ phone: null });
    const event = await makeOpenEvent(orgId, org.gbmCategoryId);
    await expect(checkIn(user, event.id, {}, ["phone", "nsbeMembershipId"])).rejects.toBeInstanceOf(AppError);
    const logged = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(logged).toContainEqual(
      expect.objectContaining({
        event: "checkin_rejected",
        userId: user.id,
        eventId: event.id,
        fieldErrors: { phone: "Required" },
        rendered: ["phone", "nsbeMembershipId"],
        unrendered: [],
      }),
    );
  });
});
