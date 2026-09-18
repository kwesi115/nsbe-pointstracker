/**
 * Point adjustments end to end, against the real Postgres at DATABASE_URL —
 * the rows, the CHECK constraints, the reads, and the cache invalidation. One
 * Org for the whole file (see test/db-fixtures.ts); each test builds its own
 * members and events inside it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AwardKind, Role } from "@/generated/prisma/enums";
import {
  checkIn,
  createTestOrg,
  makeClosedEvent,
  makeGroup,
  makeMember,
  monthOf,
  TEST_SEASON,
  type TestOrg,
} from "@/test/db-fixtures";
import { AppError } from "./errors";
import { displayTotal, standingsCacheTag } from "./points";
import { prisma } from "./prisma";
import {
  createManualAward,
  createPointAdjustment,
  createPointAdjustments,
  getEboardStandings,
  getGroupAttendanceMatrix,
  getMemberBreakdown,
  getMemberPointsPanel,
  getStandings,
  previewMonthlyChampions,
  previewPointAdjustment,
  revokePointAdjustment,
  setConfigValue,
} from "./repo";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
import { revalidateTag } from "next/cache";
const revalidateTagMock = revalidateTag as unknown as ReturnType<typeof vi.fn>;

const ACTOR = "adjuster@bison.howard.edu";
const REASON = "Checked in for a friend at the GBM";

let org: TestOrg;
let orgId: string;

beforeAll(async () => {
  org = await createTestOrg("adjustments");
  orgId = org.orgId;
  await makeMember(orgId, { role: Role.ADMIN }).then((u) => prisma.user.update({ where: { id: u.id }, data: { email: ACTOR } }));
});

afterAll(async () => {
  await org.cleanup();
});

beforeEach(() => {
  revalidateTagMock.mockClear();
});

/** A GENERAL member with `n` 2-point check-ins at closed events. */
async function memberWithEvents(n: number, overrides: Parameters<typeof makeMember>[1] = {}) {
  const user = await makeMember(orgId, overrides);
  for (let i = 0; i < n; i++) {
    const event = await makeClosedEvent(orgId, org.gbmCategoryId);
    await checkIn(user.id, event.id, overrides.role ?? Role.GENERAL);
  }
  return user;
}

const rowFor = async (email: string) => (await getStandings(orgId)).find((s) => s.email === email);

describe("creating an adjustment", () => {
  it("a negative adjustment reduces the member's total and their rank changes", async () => {
    const a = await memberWithEvents(5, { lastName: "Aardvark" }); // 10
    const b = await memberWithEvents(4, { lastName: "Badger" }); // 8
    const rankBefore = (await rowFor(a.email))!.rank;
    const bRankBefore = (await rowFor(b.email))!.rank;
    expect(rankBefore).toBeLessThan(bRankBefore);

    await createPointAdjustment({ orgId, email: a.email, points: -5, reason: REASON, actor: ACTOR });

    const after = (await rowFor(a.email))!;
    expect(after.points).toBe(5);
    expect(after.rank).toBeGreaterThan((await rowFor(b.email))!.rank);
  });

  it("stores the negative value and the true total stays negative; only the display clamps at 0", async () => {
    const a = await memberWithEvents(2); // 4
    await createPointAdjustment({ orgId, email: a.email, points: -10, reason: REASON, actor: ACTOR });

    const row = await prisma.pointAward.findFirstOrThrow({ where: { userId: a.id, kind: AwardKind.ADJUSTMENT } });
    expect(row.points).toBe(-10);
    expect(row.season).toBe(TEST_SEASON);

    const breakdown = await getMemberBreakdown(orgId, a.email);
    expect(breakdown.adjustments).toBe(-10);
    expect(breakdown.total).toBe(-6);
    expect((await rowFor(a.email))!.points).toBe(-6);
    expect(displayTotal(breakdown.total)).toBe(0);
  });

  it("two adjustments on the same member tied to the same event are independent rows and both apply", async () => {
    const a = await memberWithEvents(1);
    const event = await makeClosedEvent(orgId, org.gbmCategoryId);
    await createPointAdjustment({ orgId, email: a.email, points: 3, reason: REASON, relatedEventId: event.id, actor: ACTOR });
    await createPointAdjustment({ orgId, email: a.email, points: 4, reason: REASON, relatedEventId: event.id, actor: ACTOR });
    expect((await getMemberBreakdown(orgId, a.email)).adjustments).toBe(7);
  });

  it("requires a reason of 10+ characters that is more than one word, and a non-zero whole number", async () => {
    const a = await makeMember(orgId);
    // "correction" is exactly 10 characters — the length floor alone would accept it.
    await expect(createPointAdjustment({ orgId, email: a.email, points: -2, reason: "correction", actor: ACTOR })).rejects.toThrow(
      AppError,
    );
    await expect(createPointAdjustment({ orgId, email: a.email, points: -2, reason: "too short", actor: ACTOR })).rejects.toThrow(
      AppError,
    );
    await expect(createPointAdjustment({ orgId, email: a.email, points: 0, reason: REASON, actor: ACTOR })).rejects.toThrow(AppError);
    await expect(createPointAdjustment({ orgId, email: a.email, points: 1.5, reason: REASON, actor: ACTOR })).rejects.toThrow(AppError);
    expect(await prisma.pointAward.count({ where: { userId: a.id } })).toBe(0);
  });

  it("the database refuses an adjustment with no season or a short reason even if the app layer were bypassed", async () => {
    const a = await makeMember(orgId);
    await expect(
      prisma.pointAward.create({ data: { orgId, userId: a.id, kind: AwardKind.ADJUSTMENT, points: -1, reason: "short", season: TEST_SEASON } }),
    ).rejects.toThrow();
    await expect(
      prisma.pointAward.create({ data: { orgId, userId: a.id, kind: AwardKind.ADJUSTMENT, points: -1, reason: REASON } }),
    ).rejects.toThrow();
    // ...and only an adjustment may be negative.
    await expect(
      prisma.pointAward.create({ data: { orgId, userId: a.id, kind: AwardKind.MANUAL, points: -1, reason: REASON } }),
    ).rejects.toThrow();
    await expect(createManualAward({ orgId, email: a.email, points: -1, reason: REASON, actor: ACTOR })).rejects.toThrow(AppError);
  });

  it("writes an AdminLog entry per member", async () => {
    const [a, b] = [await makeMember(orgId), await makeMember(orgId)];
    await createPointAdjustments({ orgId, emails: [a.email, b.email], points: 2, reason: REASON, actor: ACTOR });
    const logs = await prisma.adminLog.findMany({ where: { orgId, action: "adjust_points", target: { in: [a.email, b.email] } } });
    expect(logs.map((l) => l.target).sort()).toEqual([a.email, b.email].sort());
    expect(logs[0].detail).toContain(REASON);
  });

  it("a bulk adjustment is all-or-nothing — one unknown email and no one is adjusted", async () => {
    const a = await makeMember(orgId);
    await expect(
      createPointAdjustments({ orgId, emails: [a.email, "nobody@bison.howard.edu"], points: 2, reason: REASON, actor: ACTOR }),
    ).rejects.toThrow(AppError);
    expect(await prisma.pointAward.count({ where: { userId: a.id } })).toBe(0);
  });
});

describe("revoking", () => {
  it("restores the previous total exactly, keeps the row, and logs it", async () => {
    const a = await memberWithEvents(3);
    const before = await getMemberBreakdown(orgId, a.email);
    const rankBefore = (await rowFor(a.email))!.rank;

    const adj = await createPointAdjustment({ orgId, email: a.email, points: -4, reason: REASON, actor: ACTOR });
    expect((await getMemberBreakdown(orgId, a.email)).total).toBe(before.total - 4);

    await revokePointAdjustment(orgId, adj.id, ACTOR, "Entered on the wrong member");
    expect(await getMemberBreakdown(orgId, a.email)).toEqual(before);
    expect((await rowFor(a.email))!.rank).toBe(rankBefore);

    const row = await prisma.pointAward.findUniqueOrThrow({ where: { id: adj.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokeNote).toBe("Entered on the wrong member");
    expect(await prisma.adminLog.count({ where: { orgId, action: "revoke_adjustment", target: a.email } })).toBe(1);

    const panel = await getMemberPointsPanel(orgId, a.email);
    expect(panel.adjustments).toHaveLength(1);
    expect(panel.adjustments[0].counts).toBe(false);
  });
});

describe("season scoping", () => {
  it("an adjustment belongs to its season and does not survive a rollover", async () => {
    const a = await memberWithEvents(2);
    await createPointAdjustment({ orgId, email: a.email, points: 6, reason: REASON, actor: ACTOR });
    expect((await getMemberBreakdown(orgId, a.email)).adjustments).toBe(6);

    await setConfigValue(orgId, "SEASON", "2027-2028", ACTOR);
    try {
      expect((await getMemberBreakdown(orgId, a.email)).adjustments).toBe(0);
    } finally {
      await setConfigValue(orgId, "SEASON", TEST_SEASON, ACTOR);
    }
    // Rolling back brings it back — it was never deleted, only out of season.
    expect((await getMemberBreakdown(orgId, a.email)).adjustments).toBe(6);
  });
});

describe("cache", () => {
  it("creating and revoking an adjustment both invalidate the standings cache", async () => {
    const a = await makeMember(orgId);
    const tag = standingsCacheTag(orgId, TEST_SEASON);

    const adj = await createPointAdjustment({ orgId, email: a.email, points: 1, reason: REASON, actor: ACTOR });
    expect(revalidateTagMock).toHaveBeenCalledWith(tag, { expire: 0 });

    revalidateTagMock.mockClear();
    await revokePointAdjustment(orgId, adj.id, ACTOR, "Never mind, it was fine");
    expect(revalidateTagMock).toHaveBeenCalledWith(tag, { expire: 0 });
  });
});

describe("adjustments never touch attendance-derived results", () => {
  it("does not change the Monthly Champion for the month", async () => {
    // Two members in a closed month: the one with MORE events but a huge
    // negative adjustment must still be the champion — it's an event count.
    const month = monthOf(new Date(Date.now() - 45 * 24 * 60 * 60 * 1000));
    const closesAt = new Date(`${month}-10T19:00:00`);
    const [heavy, light] = [await makeMember(orgId), await makeMember(orgId)];
    for (let i = 0; i < 3; i++) await checkIn(heavy.id, (await makeClosedEvent(orgId, org.gbmCategoryId, { closesAt })).id);
    for (let i = 0; i < 2; i++) await checkIn(light.id, (await makeClosedEvent(orgId, org.gbmCategoryId, { closesAt })).id);

    const before = await previewMonthlyChampions(orgId, month);
    await createPointAdjustment({ orgId, email: heavy.email, points: -50, reason: REASON, actor: ACTOR });
    await createPointAdjustment({ orgId, email: light.email, points: 50, reason: REASON, actor: ACTOR });
    const after = await previewMonthlyChampions(orgId, month);

    expect(after.champions).toEqual(before.champions);
    expect(after.champions.map((c) => c.email)).toContain(heavy.email);
    expect(after.champions.map((c) => c.email)).not.toContain(light.email);
  });

  it("does not change any NSBE Week bonus", async () => {
    const group = await makeGroup(orgId, [{ min: 2, max: null, bonus: 5 }], { finalized: true });
    const a = await makeMember(orgId);
    for (let i = 0; i < 2; i++) {
      await checkIn(a.id, (await makeClosedEvent(orgId, org.gbmCategoryId, { groupId: group.id })).id);
    }
    const bonusOf = async () => (await getGroupAttendanceMatrix(orgId, group.id)).find((r) => r.email === a.email)!.bonus;
    const before = await bonusOf();
    expect(before).toBe(5);
    await createPointAdjustment({ orgId, email: a.email, points: -20, reason: REASON, actor: ACTOR });
    expect(await bonusOf()).toBe(before);
    expect((await getMemberBreakdown(orgId, a.email)).nsbeWeekBonus).toBe(5);
  });

  it("an adjustment on an EBOARD member does not affect the internal board", async () => {
    const officer = await memberWithEvents(3, { role: Role.EBOARD });
    const rowOf = async () => (await getEboardStandings(orgId)).find((s) => s.email === officer.email);
    const before = await rowOf();
    expect(before?.points).toBe(3);

    await createPointAdjustment({ orgId, email: officer.email, points: -3, reason: REASON, actor: ACTOR });
    expect(await rowOf()).toEqual(before);

    // The preview warns about exactly this.
    const preview = await previewPointAdjustment(orgId, [officer.email], -3);
    expect(preview.offBoard).toEqual([expect.objectContaining({ email: officer.email, why: "eboard" })]);
  });
});

describe("the impact preview", () => {
  it("shows current and new totals and the correct projected rank", async () => {
    // A fresh org so the board is exactly these four members.
    const own = await createTestOrg("adjust-preview");
    try {
      const make = async (n: number, lastName: string) => {
        const u = await makeMember(own.orgId, { lastName });
        for (let i = 0; i < n; i++) await checkIn(u.id, (await makeClosedEvent(own.orgId, own.gbmCategoryId)).id);
        return u;
      };
      const a = await make(5, "A"); // 10
      await make(4, "B"); // 8
      await make(3, "C"); // 6
      await make(2, "D"); // 4

      const impact = await previewPointAdjustment(own.orgId, [a.email], -5);
      expect(impact.members).toEqual([
        expect.objectContaining({ email: a.email, currentTotal: 10, newTotal: 5, currentRank: 1, projectedRank: 3 }),
      ]);
      expect(impact.totalRanked).toBe(4);
      expect(impact.count).toBe(1);
      expect(impact.totalPointsAffected).toBe(-5);

      // Nothing was written by previewing.
      expect(await prisma.pointAward.count({ where: { orgId: own.orgId } })).toBe(0);

      // And the projection matches what the board actually shows once written.
      await createPointAdjustment({ orgId: own.orgId, email: a.email, points: -5, reason: REASON, actor: ACTOR });
      expect((await getStandings(own.orgId)).find((s) => s.email === a.email)?.rank).toBe(3);
    } finally {
      await own.cleanup();
    }
  });

  it("reports count and total points affected for a bulk adjustment", async () => {
    const members = [await makeMember(orgId), await makeMember(orgId), await makeMember(orgId)];
    const impact = await previewPointAdjustment(orgId, members.map((m) => m.email), -2);
    expect(impact.count).toBe(3);
    expect(impact.totalPointsAffected).toBe(-6);
  });
});
