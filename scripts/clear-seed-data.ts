/**
 * Clears every org's live/seed data down to the identity layer, so a fresh
 * season (or a first real production launch) starts with no leftover test
 * members, events, or registrations. See docs/RECOVERY.md for how the
 * pre-delete snapshot this script writes fits into the wider recovery plan.
 *
 * Usage: npm run clear-seed-data -- --confirm
 *
 * DELETES (every org): GENERAL/GUEST users, Registrations, Answers (cascade
 * from Registration), PointAwards, EventGroups, Events (FormFields cascade
 * from Event), UploadedFiles (row AND the underlying stored bytes — an
 * orphaned resume or House screenshot left behind in blob storage is a data
 * protection problem, not just a dangling row), and AdminLog entries whose
 * actor is "system" or a user this run just deleted (AdminLog.actorId is
 * ON DELETE SET NULL — see prisma/migrations/0001_init — so both cases are
 * simply "actorId IS NULL" once the user deletes above have run).
 *
 * PRESERVES: Org, EventCategory, Config, JoinCode, and every ADMIN/EBOARD
 * User (their houseProofFileId/resumeFileId are nulled out first if set,
 * since the UploadedFile rows those pointers name are about to be deleted —
 * see the "unhook preserved users" step below).
 *
 * Two hard refusals, both required (see clear-seed-guards.ts):
 *   1. --confirm must be passed explicitly.
 *   2. NODE_ENV=production requires CLEAR_SEED_ALLOW_PRODUCTION=true too.
 *
 * Idempotent: every delete below is a bulk deleteMany over a still-valid
 * `where`, not a diff against a prior run — a second run with nothing left to
 * clear just prints zero everywhere and exits 0.
 */

import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local" });

import { assertConfirmed, assertProductionAllowed, ClearSeedRefused } from "./clear-seed-guards";

interface TableCounts {
  usersAdmin: number;
  usersEboard: number;
  usersGeneral: number;
  usersGuest: number;
  registrations: number;
  answers: number;
  pointAwards: number;
  eventGroups: number;
  events: number;
  uploadedFiles: number;
  adminLogTotal: number;
  adminLogOrphaned: number;
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--confirm");

  try {
    assertConfirmed(confirmed);
    assertProductionAllowed(process.env.NODE_ENV, process.env.CLEAR_SEED_ALLOW_PRODUCTION);
  } catch (err) {
    if (err instanceof ClearSeedRefused) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const { prisma } = await import("../src/lib/prisma");
  const { storage } = await import("../src/lib/storage");
  const { writeSeasonSnapshot } = await import("../src/lib/export/snapshot");
  const { Role } = await import("../src/generated/prisma/enums");

  async function countTables(orgId: string): Promise<TableCounts> {
    const [usersAdmin, usersEboard, usersGeneral, usersGuest, registrations, answers, pointAwards, eventGroups, events, uploadedFiles, adminLogTotal, adminLogOrphaned] =
      await Promise.all([
        prisma.user.count({ where: { orgId, role: Role.ADMIN } }),
        prisma.user.count({ where: { orgId, role: Role.EBOARD } }),
        prisma.user.count({ where: { orgId, role: Role.GENERAL } }),
        prisma.user.count({ where: { orgId, role: Role.GUEST } }),
        prisma.registration.count({ where: { event: { orgId } } }),
        prisma.answer.count({ where: { registration: { event: { orgId } } } }),
        prisma.pointAward.count({ where: { orgId } }),
        prisma.eventGroup.count({ where: { orgId } }),
        prisma.event.count({ where: { orgId } }),
        prisma.uploadedFile.count({ where: { orgId } }),
        prisma.adminLog.count({ where: { orgId } }),
        prisma.adminLog.count({ where: { orgId, actorId: null } }),
      ]);
    return { usersAdmin, usersEboard, usersGeneral, usersGuest, registrations, answers, pointAwards, eventGroups, events, uploadedFiles, adminLogTotal, adminLogOrphaned };
  }

  function printCounts(label: string, c: TableCounts): void {
    console.log(`\n${label}`);
    console.log(`  Users — ADMIN: ${c.usersAdmin}, EBOARD: ${c.usersEboard}, GENERAL: ${c.usersGeneral}, GUEST: ${c.usersGuest}`);
    console.log(`  Registrations: ${c.registrations}  Answers: ${c.answers}`);
    console.log(`  PointAwards: ${c.pointAwards}  EventGroups: ${c.eventGroups}  Events: ${c.events}`);
    console.log(`  UploadedFiles: ${c.uploadedFiles}`);
    console.log(`  AdminLog: ${c.adminLogTotal} total (${c.adminLogOrphaned} with no actor — "system" or a deleted user)`);
  }

  const orgs = await prisma.org.findMany({ select: { id: true, slug: true } });
  if (orgs.length === 0) {
    console.log("No orgs found — nothing to clear.");
    await prisma.$disconnect();
    return;
  }

  for (const org of orgs) {
    console.log(`\n=== ${org.slug} (${org.id}) ===`);

    const before = await countTables(org.id);
    printCounts("Before:", before);

    console.log("\nWriting pre-delete season snapshot...");
    const snapshot = await writeSeasonSnapshot(org.id);
    console.log(`  Snapshot written: ${snapshot.key} (${snapshot.bytes} bytes)`);

    // Unhook preserved (ADMIN/EBOARD) users from any UploadedFile they own —
    // those rows are about to be deleted below, and resumeFileId/
    // houseProofFileId are plain string columns (no FK), so they'd otherwise
    // silently point at nothing.
    await prisma.user.updateMany({
      where: { orgId: org.id, role: { in: [Role.ADMIN, Role.EBOARD] }, OR: [{ resumeFileId: { not: null } }, { houseProofFileId: { not: null } }] },
      data: { resumeFileId: null, houseProofFileId: null },
    });

    console.log("\nDeleting stored file bytes for every UploadedFile...");
    const files = await prisma.uploadedFile.findMany({ where: { orgId: org.id }, select: { id: true, storageKey: true } });
    for (const file of files) {
      await storage.delete(file.storageKey);
    }
    console.log(`  Deleted ${files.length} stored file(s).`);

    // Delete order respects FK RESTRICT constraints (see prisma/migrations):
    // Registration/PointAward/UploadedFile all RESTRICT on userId, so they
    // must go before the User rows they reference. Event.categoryId RESTRICTs
    // against EventCategory (preserved, untouched), and Answer cascades from
    // Registration, so neither needs its own delete call.
    const [{ count: uploadedFiles }, { count: pointAwards }, { count: registrations }] = await Promise.all([
      prisma.uploadedFile.deleteMany({ where: { orgId: org.id } }),
      prisma.pointAward.deleteMany({ where: { orgId: org.id } }),
      prisma.registration.deleteMany({ where: { event: { orgId: org.id } } }),
    ]);
    const { count: events } = await prisma.event.deleteMany({ where: { orgId: org.id } });
    const { count: eventGroups } = await prisma.eventGroup.deleteMany({ where: { orgId: org.id } });
    const { count: users } = await prisma.user.deleteMany({ where: { orgId: org.id, role: { in: [Role.GENERAL, Role.GUEST] } } });
    // Must run AFTER the user delete above — AdminLog.actorId is
    // ON DELETE SET NULL, so a deleted user's entries only become
    // indistinguishable from "system" entries once that delete has happened.
    const { count: adminLog } = await prisma.adminLog.deleteMany({ where: { orgId: org.id, actorId: null } });

    console.log(`\nDeleted: ${users} user(s), ${registrations} registration(s), ${pointAwards} point award(s), ${eventGroups} event group(s), ${events} event(s), ${uploadedFiles} uploaded file row(s), ${adminLog} admin log entr${adminLog === 1 ? "y" : "ies"}.`);

    const after = await countTables(org.id);
    printCounts("After:", after);

    if (after.usersAdmin === 0) {
      console.warn(`  WARNING: org "${org.slug}" has zero ADMIN accounts after clearing — nobody can sign in to /admin. Re-run the seed.`);
    } else {
      console.log(`  ${after.usersAdmin} ADMIN account(s) survive and can sign in with the seeded password.`);
    }
  }

  await prisma.$disconnect();
  console.log("\nDone.");
}

main().catch(async (err) => {
  console.error("clear-seed-data FAILED:", err);
  const { prisma } = await import("../src/lib/prisma");
  await prisma.$disconnect();
  process.exit(1);
});
