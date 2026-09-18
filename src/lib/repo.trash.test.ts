/**
 * The trash bin end to end, against the real Postgres at DATABASE_URL.
 *
 * Backup storage is faked in memory (never the real bucket .env points at) —
 * but backupStorageStatus() still reads the environment for real, so the
 * "blocked without backup" tests stub the environment rather than the check.
 * Upload storage is REAL (the local-disk driver under .uploads/), because
 * "permanent deletion removes the blob, not just the row" is only proven by a
 * file that actually existed on disk and then doesn't.
 */

import ExcelJS from "exceljs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AwardKind, Permission, Role } from "@/generated/prisma/enums";
import {
  checkIn,
  createTestOrg,
  makeClosedEvent,
  makeGameBonus,
  makeGroup,
  makeMember,
  makeOpenEvent,
  monthOf,
  type TestOrg,
} from "@/test/db-fixtures";
import { checkCredentials } from "./credentials";
import { AppError } from "./errors";
import { buildEventResponsesCsv, buildLeaderboardCsv, buildMembersCsv } from "./export/csv";
import { buildWorkbookExport } from "./export/workbook";
import { formatMonthKey } from "./format";
import { hashPassword } from "./passwords";
import { prisma } from "./prisma";
import {
  calculateMonthlyChampions,
  createPointAdjustment,
  emptyTrash,
  getAddableMembers,
  getAttendance,
  getAttendanceForEvent,
  getAuthRecord,
  getAuthRecords,
  getDuesPendingMembers,
  getEboardBoardRows,
  getEvent,
  getEventAttendanceSummaries,
  getEventAttendees,
  getEventGroups,
  getEventResponses,
  getEvents,
  getEventsWithStats,
  getGroupAttendanceMatrix,
  getMember,
  getMemberBreakdown,
  getMemberById,
  getMemberHistory,
  getMembers,
  getMembersPage,
  getMembersWithStats,
  getMonthsNeedingRecalculation,
  getPointAwards,
  getPointAwardsForUser,
  getRole,
  getSessionUser,
  getStandings,
  getTrash,
  getUploadedFileForServing,
  getUserId,
  previewEmptyTrash,
  previewMonthlyChampions,
  previewTrashEvent,
  purgeTrashedEvent,
  purgeTrashedMember,
  restoreEvent,
  restoreMember,
  runTrashSweep,
  setTrashRetentionDays,
  trashEvent,
  trashMember,
} from "./repo";
import { storage } from "./storage";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

// In-memory stand-in for the backup bucket: the purge snapshots land here.
const backup = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), failNextPut: false }));
vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    backupStorage: {
      async put(key: string, buffer: Buffer) {
        if (backup.failNextPut) {
          backup.failNextPut = false;
          throw new Error("bucket unreachable");
        }
        backup.objects.set(key, buffer);
      },
      async read(key: string) {
        const b = backup.objects.get(key);
        if (!b) throw new Error("missing");
        return b;
      },
      async list(prefix: string) {
        return [...backup.objects.keys()].filter((k) => k.startsWith(prefix));
      },
      async delete(key: string) {
        backup.objects.delete(key);
      },
    },
  };
});

const ACTOR = "trash-admin@bison.howard.edu";
const REASON = "Duplicate account created by mistake";
const DAY_MS = 24 * 60 * 60 * 1000;

let org: TestOrg;
let orgId: string;

beforeAll(async () => {
  org = await createTestOrg("trash");
  orgId = org.orgId;
  const admin = await makeMember(orgId, { role: Role.ADMIN });
  await prisma.user.update({ where: { id: admin.id }, data: { email: ACTOR } });
});

afterAll(async () => {
  await org.cleanup();
});

beforeEach(() => {
  // A configured backup target for every test unless it says otherwise — the
  // real check, reading the real (stubbed) environment.
  vi.stubEnv("BACKUP_STORAGE_DRIVER", "local");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function unconfigureBackup() {
  vi.stubEnv("BACKUP_STORAGE_DRIVER", "s3");
  vi.stubEnv("BACKUP_S3_BUCKET", "");
}

const standingFor = async (email: string) => (await getStandings(orgId)).find((s) => s.email === email);

async function sheetText(buffer: Buffer, name: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(name);
  const cells: string[] = [];
  ws?.eachRow((row) => row.eachCell((c) => cells.push(String(c.value ?? ""))));
  return cells.join("\n");
}

// ---------------------------------------------------------------------------

describe("the read filter — every repo query hides trashed rows unless told otherwise", () => {
  it("covers users, events, registrations, awards, files and groups", async () => {
    const group = await makeGroup(orgId, [{ min: 1, max: null, bonus: 1 }], { finalized: true });
    const liveEvent = await makeClosedEvent(orgId, org.gbmCategoryId, { groupId: group.id, name: "Live GBM" });
    const doomedEvent = await makeClosedEvent(orgId, org.gbmCategoryId, { groupId: group.id, name: "Doomed GBM" });
    const otherEvent = await makeClosedEvent(orgId, org.gbmCategoryId);
    const live = await makeMember(orgId);
    const doomed = await makeMember(orgId);
    // Pending dues claim, so the verification queue would list them.
    await prisma.user.update({ where: { id: doomed.id }, data: { duesVerifiedAt: null } });
    await checkIn(live.id, liveEvent.id, Role.GENERAL, { q1: "live answer" });
    await checkIn(live.id, doomedEvent.id);
    await checkIn(doomed.id, liveEvent.id, Role.GENERAL, { q1: "doomed answer" });
    await makeGameBonus(orgId, live.id, doomedEvent.id);
    await createPointAdjustment({ orgId, email: doomed.email, points: 3, reason: REASON, actor: ACTOR });
    const file = await prisma.uploadedFile.create({
      data: { orgId, userId: doomed.id, kind: "RESUME", storageKey: "resume/nothing.pdf", originalName: "cv.pdf", mimeType: "application/pdf", sizeBytes: 1 },
    });

    await trashMember(orgId, doomed.email, REASON, ACTOR);
    await trashEvent(orgId, doomedEvent.id, REASON, ACTOR);

    // --- Users
    expect((await getMembers(orgId)).map((m) => m.email)).not.toContain(doomed.email);
    expect((await getMembers(orgId, { includeDeleted: true })).map((m) => m.email)).toContain(doomed.email);
    expect(await getMember(orgId, doomed.email)).toBeNull();
    expect(await getMemberById(orgId, doomed.id)).toBeNull();
    expect(await getRole(orgId, doomed.email)).toBe("general");
    expect(await getUserId(orgId, doomed.email)).toBeNull();
    expect(await getSessionUser(orgId, doomed.email)).toBeNull();
    expect(await getAuthRecord(orgId, doomed.email)).toBeNull();
    expect((await getAuthRecords(orgId)).map((a) => a.email)).not.toContain(doomed.email);
    expect((await getMembersWithStats(orgId)).map((m) => m.email)).not.toContain(doomed.email);
    expect((await getMembersPage(orgId, { q: doomed.email })).rows).toHaveLength(0);
    expect((await getDuesPendingMembers(orgId)).members.map((m) => m.email)).not.toContain(doomed.email);
    expect((await getAddableMembers(orgId, otherEvent.id, { q: doomed.email })).map((m) => m.email)).not.toContain(doomed.email);
    expect(await getUploadedFileForServing(orgId, file.id)).toBeNull();

    // --- Events
    expect((await getEvents(orgId)).map((e) => e.eventId)).not.toContain(doomedEvent.id);
    expect((await getEvents(orgId, { includeDeleted: true })).map((e) => e.eventId)).toContain(doomedEvent.id);
    expect(await getEvent(orgId, doomedEvent.id)).toBeNull();
    expect((await getEventsWithStats(orgId)).map((e) => e.eventId)).not.toContain(doomedEvent.id);
    expect((await getEventAttendanceSummaries(orgId)).map((e) => e.eventId)).not.toContain(doomedEvent.id);
    const groupRow = (await getEventGroups(orgId)).find((g) => g.id === group.id)!;
    expect(groupRow.eventIds).toEqual([liveEvent.id]);

    // --- Registrations: joined to Event AND User
    const attendance = await getAttendance(orgId);
    expect(attendance.some((a) => a.eventId === doomedEvent.id)).toBe(false);
    expect(attendance.some((a) => a.email === doomed.email)).toBe(false);
    const withTrashedMembers = await getAttendance(orgId, { includeTrashedMembers: true });
    expect(withTrashedMembers.some((a) => a.email === doomed.email)).toBe(true);
    expect(withTrashedMembers.some((a) => a.eventId === doomedEvent.id)).toBe(false); // never, for a trashed event
    expect((await getAttendanceForEvent(orgId, liveEvent.id)).map((a) => a.email)).toEqual([live.email]);
    expect(await getAttendanceForEvent(orgId, doomedEvent.id)).toEqual([]);
    expect((await getMemberHistory(orgId, live.email)).map((r) => r.eventId)).toEqual([liveEvent.id]);
    expect((await getEventResponses(orgId, liveEvent.id)).map((r) => r.email)).toEqual([live.email]);
    const attendees = await getEventAttendees(orgId, liveEvent.id);
    expect(attendees.rows.map((r) => r.email)).toEqual([live.email]);
    expect(attendees.trashedCount).toBe(1);
    // The event's HEADCOUNT keeps the trashed member — trashing hides a person, not their attendance.
    expect((await getEventsWithStats(orgId)).find((e) => e.eventId === liveEvent.id)?.registrationCount).toBe(2);

    // --- Awards
    const awards = await getPointAwards(orgId);
    expect(awards.some((a) => a.eventId === doomedEvent.id)).toBe(false);
    expect(awards.some((a) => a.email === doomed.email)).toBe(false);
    expect(await getPointAwardsForUser(orgId, live.email)).toEqual([]);

    // --- Derived
    const standing = await standingFor(live.email);
    expect(standing?.events).toBe(1);
    expect(await standingFor(doomed.email)).toBeUndefined();
    const matrix = await getGroupAttendanceMatrix(orgId, group.id);
    expect(matrix.find((r) => r.email === live.email)?.attendedEventIds).toEqual([liveEvent.id]);
    expect(matrix.some((r) => r.email === doomed.email)).toBe(false);

    // --- The trash views see both
    const trash = await getTrash(orgId);
    expect(trash.members.map((m) => m.email)).toContain(doomed.email);
    expect(trash.events.map((e) => e.id)).toContain(doomedEvent.id);
  });
});

// ---------------------------------------------------------------------------

describe("trashing a member", () => {
  it("hides them from the directory, the leaderboard, the internal board and every export", async () => {
    const event = await makeClosedEvent(orgId, org.gbmCategoryId);
    const member = await makeMember(orgId, { lastName: "Trashable" });
    const officer = await makeMember(orgId, { role: Role.EBOARD });
    await checkIn(member.id, event.id);
    await checkIn(officer.id, event.id, Role.EBOARD);
    expect(await standingFor(member.email)).toBeDefined();
    expect((await getEboardBoardRows(orgId)).map((r) => r.email)).toContain(officer.email);

    await trashMember(orgId, member.email, REASON, ACTOR);
    await trashMember(orgId, officer.email, REASON, ACTOR);

    expect((await getMembersPage(orgId, {})).rows.map((r) => r.email)).not.toContain(member.email);
    expect(await standingFor(member.email)).toBeUndefined();
    expect((await getEboardBoardRows(orgId)).map((r) => r.email)).not.toContain(officer.email);

    expect((await buildLeaderboardCsv(orgId)).csv).not.toContain(member.email);
    // Even when the export is asked for them by name.
    expect((await buildMembersCsv(orgId, [member.email])).csv).not.toContain(member.email);
    expect((await buildEventResponsesCsv(orgId, event.id)).csv).not.toContain(member.email);
    const workbook = await buildWorkbookExport(orgId);
    for (const sheet of ["Members", "Registrations", "Leaderboard", "E-Board Leaderboard"]) {
      expect(await sheetText(workbook, sheet)).not.toContain(member.email);
    }
    expect(await sheetText(workbook, "E-Board Leaderboard")).not.toContain(officer.email);
  });

  it("stops them signing in — the auth record is gone exactly as if the account didn't exist", async () => {
    const password = "a-long-enough-password";
    const member = await makeMember(orgId, { passwordHash: await hashPassword(password) });
    const before = await getAuthRecord(orgId, member.email);
    expect(before).not.toBeNull();
    expect((await checkCredentials(before!, password)).ok).toBe(true);

    await trashMember(orgId, member.email, REASON, ACTOR);

    // src/auth.ts authorize() returns null (the generic failure) on a null record,
    // and the session callback signs out on a null session user.
    expect(await getAuthRecord(orgId, member.email)).toBeNull();
    expect(await getSessionUser(orgId, member.email)).toBeNull();
  });

  it("revokes their active permission grants", async () => {
    const member = await makeMember(orgId);
    await prisma.permissionGrant.create({ data: { orgId, userId: member.id, permission: Permission.ATTENDANCE_WRITE } });
    await trashMember(orgId, member.email, REASON, ACTOR);
    const grant = await prisma.permissionGrant.findFirstOrThrow({ where: { userId: member.id } });
    expect(grant.revokedAt).not.toBeNull();
  });

  it("refuses to trash yourself or the last admin", async () => {
    await expect(trashMember(orgId, ACTOR, REASON, ACTOR)).rejects.toThrow(AppError);
    const lone = await createTestOrg("trash-last-admin");
    try {
      const admin = await makeMember(lone.orgId, { role: Role.ADMIN });
      await expect(trashMember(lone.orgId, admin.email, REASON, "someone-else@bison.howard.edu")).rejects.toMatchObject({
        code: "LAST_ADMIN",
      });
    } finally {
      await lone.cleanup();
    }
  });

  it("restoring returns them with points and adjustments intact", async () => {
    const member = await makeMember(orgId);
    for (let i = 0; i < 3; i++) await checkIn(member.id, (await makeClosedEvent(orgId, org.gbmCategoryId)).id);
    await createPointAdjustment({ orgId, email: member.email, points: -2, reason: REASON, actor: ACTOR });
    const breakdownBefore = await getMemberBreakdown(orgId, member.email);
    const standingBefore = await standingFor(member.email);
    expect(breakdownBefore.adjustments).toBe(-2);

    await trashMember(orgId, member.email, REASON, ACTOR);
    expect(await standingFor(member.email)).toBeUndefined();
    // Not revoked — just not counted while trashed.
    expect(await prisma.pointAward.count({ where: { userId: member.id, revokedAt: null } })).toBe(1);

    await restoreMember(orgId, member.id, ACTOR);
    expect(await getMemberBreakdown(orgId, member.email)).toEqual(breakdownBefore);
    expect((await standingFor(member.email))?.points).toBe(standingBefore?.points);
    expect(await prisma.adminLog.count({ where: { orgId, action: "restore_member", target: member.email } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("trashing an event", () => {
  it("decrements events-attended for everyone who checked in, and keeps every registration row", async () => {
    const [a, b] = [await makeMember(orgId), await makeMember(orgId)];
    const keep = await makeClosedEvent(orgId, org.gbmCategoryId);
    const doomed = await makeClosedEvent(orgId, org.gbmCategoryId);
    for (const m of [a, b]) {
      await checkIn(m.id, keep.id);
      await checkIn(m.id, doomed.id);
    }
    const eventsOf = async (email: string) => ({
      history: (await getMemberHistory(orgId, email)).length,
      standing: (await standingFor(email))?.events,
      directory: (await getMembersPage(orgId, { q: email })).rows[0]?.events,
    });
    expect(await eventsOf(a.email)).toEqual({ history: 2, standing: 2, directory: 2 });

    await trashEvent(orgId, doomed.id, REASON, ACTOR);

    for (const m of [a, b]) expect(await eventsOf(m.email)).toEqual({ history: 1, standing: 1, directory: 1 });
    expect(await prisma.registration.count({ where: { eventId: doomed.id } })).toBe(2);
  });

  it("contributes nothing to standings, Monthly Champion or NSBE Week counts — and restoring puts every count back exactly", async () => {
    const own = await createTestOrg("trash-restore");
    try {
      const o = own.orgId;
      const month = monthOf(new Date(Date.now() - 45 * DAY_MS));
      const closesAt = new Date(`${month}-12T19:00:00`);
      const group = await makeGroup(o, [
        { min: 2, max: 2, bonus: 3 },
        { min: 3, max: null, bonus: 5 },
      ], { finalized: true });
      const events = [];
      for (let i = 0; i < 3; i++) events.push(await makeClosedEvent(o, own.gbmCategoryId, { closesAt, groupId: group.id }));
      const doomed = events[2];
      const a = await makeMember(o, { lastName: "A" });
      const b = await makeMember(o, { lastName: "B" });
      const officer = await makeMember(o, { role: Role.EBOARD, lastName: "Officer" });
      for (const e of events) await checkIn(a.id, e.id);
      await checkIn(b.id, events[0].id);
      await checkIn(b.id, events[1].id);
      await checkIn(officer.id, doomed.id, Role.EBOARD);
      await makeGameBonus(o, a.id, doomed.id, 1);

      const snapshot = async () => ({
        standings: await getStandings(o),
        breakdowns: await Promise.all([a, b].map((m) => getMemberBreakdown(o, m.email))),
        histories: await Promise.all([a, b, officer].map(async (m) => (await getMemberHistory(o, m.email)).length)),
        directory: (await getMembersWithStats(o)).map((m) => [m.email, m.points, m.events]),
        eboard: await getEboardBoardRows(o),
        group: await getGroupAttendanceMatrix(o, group.id),
        champions: await previewMonthlyChampions(o, month),
        summaries: await getEventAttendanceSummaries(o),
      });

      const before = await snapshot();
      expect(before.breakdowns[0]).toMatchObject({ eventPoints: 6, nsbeWeekBonus: 5, gameBonus: 1 });
      expect(before.champions.champions.map((c) => c.email)).toEqual([a.email]);

      await trashEvent(o, doomed.id, REASON, ACTOR);
      const during = await snapshot();
      // Standings: event points, NSBE Week tier and the event's game bonus all drop.
      expect(during.breakdowns[0]).toMatchObject({ eventPoints: 4, nsbeWeekBonus: 3, gameBonus: 0 });
      expect(during.standings.find((s) => s.email === a.email)?.events).toBe(2);
      // Monthly Champion counts: a and b now tie at 2.
      expect(during.champions.champions.map((c) => c.email).sort()).toEqual([a.email, b.email].sort());
      // NSBE Week group counts.
      expect(during.group.find((r) => r.email === a.email)?.attendedEventIds).toHaveLength(2);
      // E-Board attendance.
      expect(during.eboard.find((r) => r.email === officer.email)?.events ?? 0).toBe(0);

      await restoreEvent(o, doomed.id, ACTOR);
      expect(await snapshot()).toEqual(before);
    } finally {
      await own.cleanup();
    }
  });

  it("in a calculated month, warns and does NOT recalculate the champion — /admin/awards flags the month instead", async () => {
    const own = await createTestOrg("trash-champion");
    try {
      const o = own.orgId;
      const month = monthOf(new Date(Date.now() - 45 * DAY_MS));
      const closesAt = new Date(`${month}-12T19:00:00`);
      const events = [];
      for (let i = 0; i < 3; i++) events.push(await makeClosedEvent(o, own.gbmCategoryId, { closesAt }));
      const champ = await makeMember(o);
      const runnerUp = await makeMember(o);
      for (const e of events) await checkIn(champ.id, e.id);
      await checkIn(runnerUp.id, events[0].id);
      await checkIn(runnerUp.id, events[1].id);

      await calculateMonthlyChampions(o, month, 5, ACTOR);
      const awardsBefore = await prisma.pointAward.findMany({ where: { orgId: o, kind: AwardKind.MONTHLY_CHAMPION } });
      expect(awardsBefore.map((x) => x.userId)).toEqual([champ.id]);

      const preview = await previewTrashEvent(o, events[2].id);
      expect(preview.championWarning?.message).toBe(
        `${formatMonthKey(month)}'s Monthly Champion was calculated using this event. Deleting it may change who qualified. Recalculate ${formatMonthKey(month)} after deleting.`,
      );

      await trashEvent(o, events[2].id, REASON, ACTOR);
      // Nothing recalculated: the same award rows, none revoked, none added.
      expect(await prisma.pointAward.findMany({ where: { orgId: o, kind: AwardKind.MONTHLY_CHAMPION } })).toEqual(awardsBefore);
      expect((await getMonthsNeedingRecalculation(o)).map((m) => m.month)).toEqual([month]);

      // Recalculating clears the flag.
      await calculateMonthlyChampions(o, month, 5, ACTOR);
      expect(await getMonthsNeedingRecalculation(o)).toEqual([]);
    } finally {
      await own.cleanup();
    }
  });

  it("an NSBE Week event shows the bonus impact before confirming", async () => {
    const own = await createTestOrg("trash-nsbe");
    try {
      const o = own.orgId;
      const group = await makeGroup(o, [
        { min: 2, max: 2, bonus: 3 },
        { min: 3, max: null, bonus: 5 },
      ], { finalized: true, expectedEventCount: 3 });
      const events = [];
      for (let i = 0; i < 3; i++) events.push(await makeClosedEvent(o, own.gbmCategoryId, { groupId: group.id }));
      const all3 = [await makeMember(o), await makeMember(o), await makeMember(o)];
      for (const m of all3) for (const e of events) await checkIn(m.id, e.id);
      const two = await makeMember(o);
      await checkIn(two.id, events[0].id);
      await checkIn(two.id, events[1].id);

      const preview = await previewTrashEvent(o, events[2].id);
      expect(preview.groupImpact).toMatchObject({
        finalized: true,
        eventsBefore: 3,
        eventsAfter: 2,
        transitions: [{ from: 5, to: 3, members: 3 }],
        unreachableTiers: [{ min: 3, max: null, bonus: 5 }],
      });
      // Previewing changed nothing.
      expect((await getMemberBreakdown(o, all3[0].email)).nsbeWeekBonus).toBe(5);
    } finally {
      await own.cleanup();
    }
  });

  it("cannot trash an event whose check-in window is open", async () => {
    const event = await makeOpenEvent(orgId, org.gbmCategoryId);
    expect((await previewTrashEvent(orgId, event.id)).windowOpen).toBe(true);
    await expect(trashEvent(orgId, event.id, REASON, ACTOR)).rejects.toThrow(/Close it first/);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).deletedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("permanent deletion", () => {
  it("destroys a member's registrations, answers, awards, grants, file rows AND the stored blobs — after a snapshot", async () => {
    const event = await makeClosedEvent(orgId, org.gbmCategoryId);
    const member = await makeMember(orgId);
    const registration = await checkIn(member.id, event.id, Role.GENERAL, { q1: "an answer" });
    await makeGameBonus(orgId, member.id, event.id);
    await createPointAdjustment({ orgId, email: member.email, points: -1, reason: REASON, actor: ACTOR });
    await prisma.permissionGrant.create({ data: { orgId, userId: member.id, permission: Permission.VERIFICATIONS_WRITE } });
    const stored = await storage.put({ buffer: Buffer.from("%PDF-1.4 resume"), kind: "resume", extension: ".pdf" });
    const file = await prisma.uploadedFile.create({
      data: { orgId, userId: member.id, kind: "RESUME", storageKey: stored.storageKey, originalName: "cv.pdf", mimeType: "application/pdf", sizeBytes: 15 },
    });
    expect((await storage.read(stored.storageKey)).toString()).toContain("resume");

    await trashMember(orgId, member.email, REASON, ACTOR);
    await expect(purgeTrashedMember(orgId, member.id, ACTOR, { confirm: "wrong@bison.howard.edu" })).rejects.toThrow(AppError);

    const result = await purgeTrashedMember(orgId, member.id, ACTOR, { confirm: member.email.toUpperCase() });

    expect(await prisma.user.findUnique({ where: { id: member.id } })).toBeNull();
    expect(await prisma.registration.count({ where: { userId: member.id } })).toBe(0);
    expect(await prisma.answer.count({ where: { registrationId: registration.id } })).toBe(0);
    expect(await prisma.pointAward.count({ where: { userId: member.id } })).toBe(0);
    expect(await prisma.permissionGrant.count({ where: { userId: member.id } })).toBe(0);
    expect(await prisma.uploadedFile.count({ where: { id: file.id } })).toBe(0);
    // The blob itself, not just the row.
    await expect(storage.read(stored.storageKey)).rejects.toThrow();
    expect(result.blobFailures).toEqual([]);

    // The snapshot was taken, and holds the rows that are now gone.
    const snapshot = JSON.parse(backup.objects.get(result.snapshotKey)!.toString("utf8"));
    expect(snapshot.rows.user.email).toBe(member.email);
    expect(snapshot.rows.registrations).toHaveLength(1);
    expect(snapshot.rows.awards).toHaveLength(2);

    // And the record survives the row.
    const log = await prisma.adminLog.findFirstOrThrow({ where: { orgId, action: "purge_member", target: member.email } });
    expect(log.detail).toContain("1 registration(s)");
    expect(log.detail).toContain("points at deletion");
    expect(log.detail).toContain(result.snapshotKey);
  });

  it("destroys an event's registrations, answers and game bonuses; a linked adjustment keeps its points", async () => {
    const event = await makeClosedEvent(orgId, org.gbmCategoryId, { name: "Purge Me" });
    const member = await makeMember(orgId);
    const registration = await checkIn(member.id, event.id, Role.GENERAL, { q1: "x" });
    await makeGameBonus(orgId, member.id, event.id);
    const adj = await createPointAdjustment({ orgId, email: member.email, points: 2, reason: REASON, relatedEventId: event.id, actor: ACTOR });

    await trashEvent(orgId, event.id, REASON, ACTOR);
    await expect(purgeTrashedEvent(orgId, event.id, ACTOR, { confirm: "Purge" })).rejects.toThrow(AppError);
    await purgeTrashedEvent(orgId, event.id, ACTOR, { confirm: "Purge Me" });

    expect(await prisma.event.findUnique({ where: { id: event.id } })).toBeNull();
    expect(await prisma.registration.count({ where: { id: registration.id } })).toBe(0);
    expect(await prisma.answer.count({ where: { registrationId: registration.id } })).toBe(0);
    expect(await prisma.pointAward.count({ where: { eventId: event.id } })).toBe(0);
    const kept = await prisma.pointAward.findUniqueOrThrow({ where: { id: adj.id } });
    expect(kept.relatedEventId).toBeNull();
    expect(kept.points).toBe(2);
  });

  it("is blocked, with nothing deleted, when backup storage is unconfigured — and so is scheduled expiry", async () => {
    const member = await makeMember(orgId);
    await trashMember(orgId, member.email, REASON, ACTOR, new Date(Date.now() - 60 * DAY_MS)); // long past its date
    unconfigureBackup();

    await expect(purgeTrashedMember(orgId, member.id, ACTOR, { confirm: member.email })).rejects.toMatchObject({
      code: "BACKUP_UNAVAILABLE",
    });
    await expect(emptyTrash(orgId, ACTOR, "DELETE")).rejects.toMatchObject({ code: "BACKUP_UNAVAILABLE" });
    const sweep = await runTrashSweep(orgId, { force: true });
    expect(sweep).toMatchObject({ ran: false, reason: "backup_unconfigured" });
    expect((await getTrash(orgId)).backup.configured).toBe(false);

    expect(await prisma.user.findUnique({ where: { id: member.id } })).not.toBeNull();
  });

  it("is blocked when the snapshot write itself fails", async () => {
    const member = await makeMember(orgId);
    await trashMember(orgId, member.email, REASON, ACTOR);
    backup.failNextPut = true;
    await expect(purgeTrashedMember(orgId, member.id, ACTOR)).rejects.toMatchObject({ code: "BACKUP_UNAVAILABLE" });
    expect(await prisma.user.findUnique({ where: { id: member.id } })).not.toBeNull();
  });

  it("only ever deletes what is in the trash", async () => {
    const member = await makeMember(orgId);
    await expect(purgeTrashedMember(orgId, member.id, ACTOR)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.user.findUnique({ where: { id: member.id } })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("expiry", () => {
  it("the lazy sweep runs at most once per hour, and purges what is past its date", async () => {
    const own = await createTestOrg("trash-sweep");
    try {
      const o = own.orgId;
      await makeMember(o, { role: Role.ADMIN }).then((u) => prisma.user.update({ where: { id: u.id }, data: { email: ACTOR } }));
      const t0 = new Date();
      const expired = await makeMember(o);
      await trashMember(o, expired.email, REASON, ACTOR, new Date(t0.getTime() - 31 * DAY_MS));
      const fresh = await makeMember(o);
      await trashMember(o, fresh.email, REASON, ACTOR, t0);

      const first = await runTrashSweep(o, { now: t0 });
      expect(first.ran).toBe(true);
      expect(first.ran && first.purged.map((p) => p.id)).toEqual([expired.id]);
      expect(await prisma.user.findUnique({ where: { id: fresh.id } })).not.toBeNull();

      expect(await runTrashSweep(o, { now: new Date(t0.getTime() + 10 * 60 * 1000) })).toEqual({ ran: false, reason: "rate_limited" });
      expect(await runTrashSweep(o, { now: new Date(t0.getTime() + 59 * 60 * 1000) })).toEqual({ ran: false, reason: "rate_limited" });
      expect((await runTrashSweep(o, { now: new Date(t0.getTime() + 61 * 60 * 1000) })).ran).toBe(true);

      // Concurrent loads: exactly one of them gets the slot.
      const later = new Date(t0.getTime() + 3 * 60 * 60 * 1000);
      const racing = await Promise.all([runTrashSweep(o, { now: later }), runTrashSweep(o, { now: later }), runTrashSweep(o, { now: later })]);
      expect(racing.filter((r) => r.ran)).toHaveLength(1);
    } finally {
      await own.cleanup();
    }
  });

  it("changing the retention recomputes the deletion date of everything already in the trash", async () => {
    const own = await createTestOrg("trash-retention");
    try {
      const o = own.orgId;
      const deletedAt = new Date("2026-09-01T12:00:00Z");
      const member = await makeMember(o);
      const event = await makeClosedEvent(o, own.gbmCategoryId);
      await trashMember(o, member.email, REASON, ACTOR, deletedAt);
      await trashEvent(o, event.id, REASON, ACTOR, deletedAt);
      const at = async () => ({
        member: (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).permanentDeleteAt!.getTime(),
        event: (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).permanentDeleteAt!.getTime(),
      });
      expect(await at()).toEqual({ member: deletedAt.getTime() + 30 * DAY_MS, event: deletedAt.getTime() + 30 * DAY_MS });

      expect(await setTrashRetentionDays(o, 7, ACTOR)).toEqual({ members: 1, events: 1 });
      expect(await at()).toEqual({ member: deletedAt.getTime() + 7 * DAY_MS, event: deletedAt.getTime() + 7 * DAY_MS });
      await expect(setTrashRetentionDays(o, 0, ACTOR)).rejects.toThrow(AppError);
    } finally {
      await own.cleanup();
    }
  });
});

describe("Empty trash", () => {
  it("requires typing DELETE and reports exactly what it will remove", async () => {
    const own = await createTestOrg("trash-empty");
    try {
      const o = own.orgId;
      const event = await makeClosedEvent(o, own.gbmCategoryId);
      const doomedEvent = await makeClosedEvent(o, own.gbmCategoryId);
      const [m1, m2, bystander] = [await makeMember(o), await makeMember(o), await makeMember(o)];
      await checkIn(m1.id, event.id, Role.GENERAL, { q1: "a", q2: "b" });
      await checkIn(m1.id, doomedEvent.id); // shared by a trashed member AND a trashed event — counted once
      await checkIn(bystander.id, doomedEvent.id, Role.GENERAL, { q1: "c" });
      await checkIn(bystander.id, event.id); // survives
      await makeGameBonus(o, bystander.id, doomedEvent.id);
      await createPointAdjustment({ orgId: o, email: m2.email, points: -3, reason: REASON, actor: ACTOR });
      await prisma.permissionGrant.create({ data: { orgId: o, userId: m2.id, permission: Permission.ATTENDANCE_WRITE } });
      await prisma.uploadedFile.create({
        data: { orgId: o, userId: m2.id, kind: "RESUME", storageKey: "resume/missing.pdf", originalName: "cv.pdf", mimeType: "application/pdf", sizeBytes: 2048 },
      });
      await trashMember(o, m1.email, REASON, ACTOR);
      await trashMember(o, m2.email, REASON, ACTOR);
      await trashEvent(o, doomedEvent.id, REASON, ACTOR);

      expect(await previewEmptyTrash(o)).toMatchObject({
        members: 2,
        events: 1,
        registrations: 3, // m1@event, m1@doomed, bystander@doomed
        answers: 3,
        awards: 2, // bystander's game bonus on the doomed event, m2's adjustment
        adjustments: 1,
        grants: 1,
        files: 1,
        fileBytes: 2048,
      });

      await expect(emptyTrash(o, ACTOR, "delete")).rejects.toThrow(AppError);
      expect((await getTrash(o)).members).toHaveLength(2);

      const result = await emptyTrash(o, ACTOR, "DELETE");
      expect(result.purged).toHaveLength(3);
      const trash = await getTrash(o);
      expect(trash.members).toHaveLength(0);
      expect(trash.events).toHaveLength(0);
      expect(await prisma.registration.count({ where: { userId: bystander.id } })).toBe(1);
    } finally {
      await own.cleanup();
    }
  });
});
