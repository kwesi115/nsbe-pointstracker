/**
 * One-off, idempotent repair for membership-claim state (dues / national /
 * House). Reports by default; writes ONLY with --confirm.
 *
 *   npx tsx scripts/repair-claim-state.ts              # report only
 *   npx tsx scripts/repair-claim-state.ts --confirm    # apply the repairs
 *   npx tsx scripts/repair-claim-state.ts --url=DIRECT_URL
 *
 * Take a snapshot first: `npm run backup`.
 *
 * What it will NOT do, deliberately:
 *
 *   - It never verifies anything retroactively. A claim nobody checked stays
 *     pending, forever if need be. Manufacturing a verification would defeat
 *     the entire point of having the state in the first place.
 *   - It never clears a self-reported flag. Those flags drive leaderboard
 *     eligibility (lib/points.ts isEligible), so clearing one silently drops
 *     a member off the board.
 *   - It never guesses a verifier. A row stamped verified with no verifier id
 *     is data corruption; it is REPORTED for a human to decide, not patched.
 *
 * The one thing it does write is the stale-revoke repair: a row that is
 * reported = true AND still carries a *RevokedAt stamp. That combination is
 * unreachable through the current code (setDuesReported and registerForEvent
 * now clear the revoke stamps when a member re-claims), but a row written
 * before that fix is stuck: claimState resolves it to "revoked", so the audit
 * queue never shows it, while the reported flag keeps the member on the
 * leaderboard. Clearing the stale stamp puts the claim back in the queue as
 * pending — a NEW claim awaiting a NEW decision. It changes nothing about
 * eligibility, and the original revoke is still in AdminLog.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { claimState } from "../src/lib/claim-state";

const CONFIRM = process.argv.includes("--confirm");
const urlArg = process.argv.find((a) => a.startsWith("--url="));
const URL_VAR = urlArg ? urlArg.slice("--url=".length) : "DATABASE_URL";

const connectionString = process.env[URL_VAR];
if (!connectionString) throw new Error(`${URL_VAR} is not set`);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function line(label: string, value: string | number) {
  console.log(`  ${label.padEnd(46)} ${value}`);
}

async function main() {
  console.log(`\nrepair-claim-state — ${CONFIRM ? "APPLY (--confirm)" : "REPORT ONLY"} — via ${URL_VAR} (${new URL(connectionString!).host})`);

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      house: true,
      houseVerifiedAt: true,
      houseVerifiedById: true,
      duesPaidReported: true,
      duesReportedAt: true,
      duesVerifiedAt: true,
      duesVerifiedById: true,
      duesRevokedAt: true,
      duesRevokedById: true,
      nationalMemberReported: true,
      nationalVerifiedAt: true,
      nationalVerifiedById: true,
      nationalRevokedAt: true,
      nationalRevokedById: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // ---- 1. The four states, per claim, for the whole roster ----------------
  for (const claim of ["dues", "national"] as const) {
    const counts = { none: 0, pending: 0, verified: 0, revoked: 0 };
    const byRole = new Map<string, typeof counts>();
    for (const u of users) {
      const state =
        claim === "dues"
          ? claimState(u.duesPaidReported, u.duesVerifiedAt, u.duesRevokedAt)
          : claimState(u.nationalMemberReported, u.nationalVerifiedAt, u.nationalRevokedAt);
      counts[state] += 1;
      const forRole = byRole.get(u.role) ?? { none: 0, pending: 0, verified: 0, revoked: 0 };
      forRole[state] += 1;
      byRole.set(u.role, forRole);
    }
    console.log(`\n${claim.toUpperCase()} claim states (${users.length} accounts)`);
    line("none (never claimed)", counts.none);
    line("pending (self-reported, unverified)", counts.pending);
    line("verified", counts.verified);
    line("revoked", counts.revoked);
    for (const [role, c] of [...byRole].sort()) {
      line(`  ${role}: none/pending/verified/revoked`, `${c.none} / ${c.pending} / ${c.verified} / ${c.revoked}`);
    }
  }

  // ---- 2. Data corruption — REPORT ONLY, never repaired -------------------
  // A *VerifiedAt with no *VerifiedById cannot be reconstructed: the only
  // record of who verified it would be an AdminLog entry, and matching one
  // up is a judgement call, not a migration. Listed for a human.
  const corrupt = users.filter(
    (u) =>
      (u.duesVerifiedAt && !u.duesVerifiedById) ||
      (!u.duesVerifiedAt && u.duesVerifiedById) ||
      (u.nationalVerifiedAt && !u.nationalVerifiedById) ||
      (!u.nationalVerifiedAt && u.nationalVerifiedById) ||
      (u.houseVerifiedAt && !u.houseVerifiedById) ||
      // Verified and revoked at once — the writers keep these mutually
      // exclusive, so a row with both predates that or was written by hand.
      (u.duesVerifiedAt && u.duesRevokedAt) ||
      (u.nationalVerifiedAt && u.nationalRevokedAt),
  );
  console.log(`\nDATA CORRUPTION — reported, never repaired (${corrupt.length})`);
  if (corrupt.length === 0) {
    console.log("  none");
  } else {
    for (const u of corrupt) {
      const why: string[] = [];
      if (u.duesVerifiedAt && !u.duesVerifiedById) why.push("dues verified with no verifier id");
      if (!u.duesVerifiedAt && u.duesVerifiedById) why.push("dues verifier id with no timestamp");
      if (u.nationalVerifiedAt && !u.nationalVerifiedById) why.push("national verified with no verifier id");
      if (!u.nationalVerifiedAt && u.nationalVerifiedById) why.push("national verifier id with no timestamp");
      if (u.houseVerifiedAt && !u.houseVerifiedById) why.push("house verified with no verifier id");
      if (u.duesVerifiedAt && u.duesRevokedAt) why.push("dues verified AND revoked");
      if (u.nationalVerifiedAt && u.nationalRevokedAt) why.push("national verified AND revoked");
      console.log(`  ${u.email} (${u.role}, created ${u.createdAt.toISOString().slice(0, 10)}) — ${why.join("; ")}`);
    }
    console.log("  ^ decide these by hand. This script will not guess a verifier or pick a winner.");
  }

  // ---- 3. Accounts with no House -----------------------------------------
  // Reported, not repaired: there is nothing to write. getMissingFields
  // already asks these accounts for a House at their next check-in and lists
  // it on /account; they are here so they're findable.
  const houseless = users.filter((u) => !u.house && u.role !== "ADMIN");
  console.log(`\nNO HOUSE ON FILE — reported only, nothing to repair (${houseless.length})`);
  if (houseless.length === 0) console.log("  none");
  for (const u of houseless) {
    console.log(`  ${u.email} (${u.role}, ${u.status}, created ${u.createdAt.toISOString().slice(0, 10)})`);
  }

  // ---- 4. The one repairable class: a stale revoke on a live claim --------
  const staleDues = users.filter((u) => u.duesPaidReported === true && u.duesRevokedAt !== null);
  const staleNational = users.filter((u) => u.nationalMemberReported === true && u.nationalRevokedAt !== null);
  console.log(`\nSTALE REVOKE ON A RE-REPORTED CLAIM — repairable (${staleDues.length} dues, ${staleNational.length} national)`);
  for (const u of staleDues) console.log(`  dues     ${u.email} (${u.role}) — reported again ${u.duesReportedAt?.toISOString().slice(0, 10) ?? "?"}, revoke stamp from ${u.duesRevokedAt!.toISOString().slice(0, 10)}`);
  for (const u of staleNational) console.log(`  national ${u.email} (${u.role}) — revoke stamp from ${u.nationalRevokedAt!.toISOString().slice(0, 10)}`);
  if (staleDues.length === 0 && staleNational.length === 0) console.log("  none");

  if (!CONFIRM) {
    console.log(
      `\nNo writes made. Re-run with --confirm to clear ${staleDues.length + staleNational.length} stale revoke stamp(s). Snapshot first: npm run backup\n`,
    );
    await prisma.$disconnect();
    return;
  }

  // Idempotent: the WHERE clause is the defect itself, so a second run
  // matches nothing.
  const duesFixed = await prisma.user.updateMany({
    where: { duesPaidReported: true, duesRevokedAt: { not: null } },
    data: { duesRevokedAt: null, duesRevokedById: null, duesRevokedNote: null },
  });
  const nationalFixed = await prisma.user.updateMany({
    where: { nationalMemberReported: true, nationalRevokedAt: { not: null } },
    data: { nationalRevokedAt: null, nationalRevokedById: null, nationalRevokedNote: null },
  });
  console.log(`\nApplied: cleared ${duesFixed.count} dues and ${nationalFixed.count} national stale revoke stamp(s).`);
  console.log("Nothing was verified, and no self-reported flag was touched — leaderboard membership is unchanged.\n");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
