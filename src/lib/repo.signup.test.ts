/**
 * The signup latch against the real Postgres instance at DATABASE_URL (see
 * vitest.setup.ts).
 *
 * Two things can only be tested here rather than in signup.test.ts:
 *
 *   - completeSignup refuses to latch an account that still has steps left.
 *     That refusal is the gate's actual boundary: the client asking to be let
 *     in is precisely the claim that must not be trusted.
 *   - the backfill migration's SQL agrees with requiredSignupFieldsComplete
 *     row for row. They are two expressions of one predicate in two languages,
 *     and the migration has already run on this database — so this asserts the
 *     agreement over every row it actually touched, rather than over fixtures.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { prisma } from "./prisma";
import { completeSignup, getSignupUser } from "./repo";
import { requiredSignupFieldsComplete, signupIsComplete, type SignupUser } from "./signup";
import { Classification, Role, UserStatus } from "@/generated/prisma/enums";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const SEASON = "2026-2027";

let orgId: string;

beforeAll(async () => {
  const org = await prisma.org.create({
    data: { slug: `signup-test-${randomUUID()}`, name: "Signup Test Org", shortName: "ST" },
  });
  orgId = org.id;
  await prisma.config.create({ data: { orgId, key: "SEASON", value: SEASON } });
});

afterAll(async () => {
  await prisma.adminLog.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.config.deleteMany({ where: { orgId } });
  await prisma.org.delete({ where: { id: orgId } });
});

/** Every required field answered — the shape an account has the moment the wizard's last step saves. */
function completeFields() {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    studentId: `S${randomUUID().slice(0, 8)}`,
    classification: Classification.JUNIOR,
    major: "Computer Engineering",
    phone: "202-555-0100",
    personalEmail: "ada@example.com",
    profileSeason: SEASON,
    duesPaidReported: true,
    nationalMemberReported: true,
    membershipSeason: SEASON,
    house: "House Turing",
  };
}

async function makeUser(data: Record<string, unknown> = {}): Promise<string> {
  const email = `resume-${randomUUID()}@bison.howard.edu`;
  await prisma.user.create({
    data: {
      orgId,
      email,
      passwordHash: "x",
      firstName: "Ada",
      lastName: "Lovelace",
      role: Role.GENERAL,
      status: UserStatus.ACTIVE,
      ...data,
    },
  });
  return email;
}

describe("completeSignup latches only when the work is actually done", () => {
  it("refuses an account that still has steps outstanding, and says which", async () => {
    // Freshly created by the wizard's step 3: name and account, nothing else.
    const email = await makeUser({ studentId: "9001", classification: Classification.JUNIOR, major: "CE", profileSeason: SEASON });

    await expect(completeSignup(orgId, email)).rejects.toBeInstanceOf(AppError);
    const row = await prisma.user.findFirstOrThrow({ where: { orgId, email } });
    expect(row.signupCompletedAt).toBeNull();

    const user = await getSignupUser(orgId, email);
    expect(requiredSignupFieldsComplete(user!)).toBe(false);
  });

  it("latches an account whose required steps are all answered", async () => {
    const email = await makeUser(completeFields());

    const { completedAt } = await completeSignup(orgId, email);
    expect(completedAt).toBeInstanceOf(Date);

    const row = await prisma.user.findFirstOrThrow({ where: { orgId, email } });
    expect(row.signupCompletedAt).not.toBeNull();
    expect(signupIsComplete((await getSignupUser(orgId, email))!)).toBe(true);
  });

  it("accepts the House skip, which writes nothing and so cannot be read back", async () => {
    const { house: _house, ...withoutHouse } = completeFields();
    void _house;
    const email = await makeUser(withoutHouse);

    // Without the declaration it is refused...
    await expect(completeSignup(orgId, email)).rejects.toBeInstanceOf(AppError);
    // ...and with it, it completes — leaving the House genuinely unset, so
    // check-in still asks (see lib/core-form.ts getMissingFields).
    await expect(completeSignup(orgId, email, { houseSkipped: true })).resolves.toMatchObject({ missingSteps: [] });

    const row = await prisma.user.findFirstOrThrow({ where: { orgId, email } });
    expect(row.signupCompletedAt).not.toBeNull();
    expect(row.house).toBeNull();
  });

  it("skipping the resume upload does not block the latch", async () => {
    const email = await makeUser({ ...completeFields(), resumeFileId: null });
    await expect(completeSignup(orgId, email)).resolves.toMatchObject({ missingSteps: [] });
  });

  it("an ADMIN account latches immediately, even with a blank surname — the seeded-officer shape", async () => {
    const email = await makeUser({ role: Role.ADMIN, firstName: "President", lastName: "" });
    await expect(completeSignup(orgId, email)).resolves.toMatchObject({ missingSteps: [] });
  });

  it("is idempotent — a double-submitted finish does not move the timestamp", async () => {
    const email = await makeUser(completeFields());
    const first = await completeSignup(orgId, email);
    const second = await completeSignup(orgId, email);
    expect(second.completedAt.getTime()).toBe(first.completedAt.getTime());
  });

  it("records the completion in the admin log, so the roster can show when signup finished", async () => {
    const email = await makeUser(completeFields());
    await completeSignup(orgId, email);
    const logged = await prisma.adminLog.count({ where: { orgId, action: "complete_signup", target: email } });
    expect(logged).toBe(1);
  });

  it("refuses an email with no account at all", async () => {
    await expect(completeSignup(orgId, `ghost-${randomUUID()}@bison.howard.edu`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("the backfill migration agrees with requiredSignupFieldsComplete, row for row", () => {
  /**
   * The migration has already run against this database. So for every row it
   * saw, the SQL's verdict (did it set signupCompletedAt?) must match the TS
   * predicate's verdict — otherwise the two copies of the rule have drifted and
   * some member is either gated wrongly or let through wrongly.
   *
   * One query, evaluated in memory: this file runs alongside the other
   * database suites, and a per-row round trip over the whole User table starves
   * the connection pool they are all sharing.
   */
  const MIGRATED_AT = new Date("2026-09-12T09:00:00Z");

  /**
   * The row -> predicate-input mapping, kept local and minimal rather than
   * reaching for repo's private userToMember: this test is checking the SQL
   * against the predicate, so it should depend on as little of the code under
   * test as possible.
   */
  function toSignupUser(row: {
    role: string;
    firstName: string;
    lastName: string;
    studentId: string | null;
    phone: string | null;
    personalEmail: string | null;
    tshirtSize: string | null;
    classification: string | null;
    major: string | null;
    majorOther: string | null;
    profileSeason: string | null;
    duesPaidReported: boolean | null;
    nationalMemberReported: boolean | null;
    membershipSeason: string | null;
    house: string | null;
    houseVerifiedAt: Date | null;
    resumeFileId: string | null;
    signupCompletedAt: Date | null;
  }): SignupUser {
    return {
      role: row.role.toLowerCase() as SignupUser["role"],
      firstName: row.firstName,
      lastName: row.lastName,
      studentId: row.studentId ?? "",
      phone: row.phone ?? "",
      personalEmail: row.personalEmail ?? "",
      tshirtSize: (row.tshirtSize ?? "") as SignupUser["tshirtSize"],
      classification: (row.classification?.toLowerCase() ?? "") as SignupUser["classification"],
      major: row.major ?? "",
      majorOther: row.majorOther ?? "",
      profileSeason: row.profileSeason ?? "",
      duesPaidReported: row.duesPaidReported,
      nationalMemberReported: row.nationalMemberReported,
      membershipSeason: row.membershipSeason ?? "",
      house: row.house ?? "",
      houseVerifiedAt: row.houseVerifiedAt,
      resumeFileId: row.resumeFileId,
      signupCompletedAt: row.signupCompletedAt,
    };
  }

  it("every latched row satisfies the predicate, and every unlatched one does not", async () => {
    const rows = await prisma.user.findMany({ where: { createdAt: { lt: MIGRATED_AT } } });
    // Guard against the assertion passing vacuously on an empty set.
    expect(rows.length).toBeGreaterThan(0);

    const disagreements = rows
      .map((row) => ({
        email: row.email,
        role: row.role,
        latched: row.signupCompletedAt !== null,
        // ADMIN and GUEST are latched by the SQL on role alone, which the
        // predicate independently agrees with (their step list has no profile
        // steps) — so the two verdicts still have to match.
        predicate: requiredSignupFieldsComplete(toSignupUser(row)),
      }))
      .filter((r) => r.latched !== r.predicate);

    // A latched row the predicate rejects would mean someone got in with an
    // unfinished profile; the reverse would mean someone already complete is
    // being sent back through a wizard.
    expect(disagreements).toEqual([]);
  });

  it("no row that predates the migration was left in an ambiguous state", async () => {
    const ambiguous = await prisma.user.findMany({
      where: {
        createdAt: { lt: MIGRATED_AT },
        signupCompletedAt: null,
        role: { in: [Role.ADMIN, Role.GUEST] },
      },
      select: { email: true },
    });
    // An ADMIN or GUEST row is never mid-signup — the migration latches those
    // outright, which is what keeps every seeded officer out of the gate.
    expect(ambiguous).toEqual([]);
  });
});
