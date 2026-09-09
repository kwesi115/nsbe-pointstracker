/**
 * Runs the actual seed CLI (not its internals) against the real Postgres
 * instance at DATABASE_URL, twice, and confirms row counts are stable. There
 * is no migration script in this app (Part 5: the old workbook only ever
 * held seed data, so there's nothing to migrate) — this is the idempotency
 * guarantee that matters here instead.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { Role, UserStatus } from "@/generated/prisma/enums";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";

function runSeed(): void {
  // shell:true is required for npx/npx.cmd resolution on Windows. Args are
  // fixed literals (no user input), so the shell-injection concern the
  // Node deprecation warning is about doesn't apply here.
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { env: process.env, stdio: "pipe", shell: true });
}

describe("prisma/seed.ts — idempotency", () => {
  it("running the seed script twice does not duplicate EventCategory, Config, or User rows", async () => {
    runSeed();
    const org = await prisma.org.findUniqueOrThrow({ where: { slug: "howard-nsbe" } });
    const orgId = org.id;
    const counts = () =>
      Promise.all([
        prisma.eventCategory.count({ where: { orgId } }),
        prisma.config.count({ where: { orgId } }),
        prisma.user.count({ where: { orgId } }),
      ]);
    const before = await counts();

    runSeed();
    const after = await counts();

    expect(after).toEqual(before);
    expect(after[0]).toBe(10); // the ten seeded categories (incl. E-Board Meeting/Retreat), and no more — scoped to the seeded org, since other tests may create their own orgs concurrently
  }, 30_000);
});

// Mirrors prisma/seed.ts's own HARDCODED_ADMINS — kept as a separate literal
// here (not imported) since seed.ts is a self-invoking script, not a module
// other code imports from.
const HARDCODED_ADMINS = [
  { email: "hunsbemembership@gmail.com", eboardPosition: "Membership Chair" },
  { email: "nsbeproghu@gmail.com", eboardPosition: "Programs Chair" },
  { email: "hunsbepres@gmail.com", eboardPosition: "President" },
  { email: "nsbevphu@gmail.com", eboardPosition: "Vice President" },
  { email: "hunsbeparliamentarian@gmail.com", eboardPosition: "Parliamentarian" },
  { email: "nsbesecretaryhu@gmail.com", eboardPosition: "Secretary" },
  { email: "nsbetreashu@gmail.com", eboardPosition: "Treasurer" },
];

describe("prisma/seed.ts — Howard NSBE officer accounts", () => {
  it("seeds all seven accounts as ACTIVE ADMIN with the right eboardPosition, no forced password change, and the seed password", async () => {
    runSeed();
    const org = await prisma.org.findUniqueOrThrow({ where: { slug: "howard-nsbe" } });
    const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? "howard1867";

    for (const { email, eboardPosition } of HARDCODED_ADMINS) {
      const user = await prisma.user.findUniqueOrThrow({ where: { orgId_email: { orgId: org.id, email } } });
      expect(user.role).toBe(Role.ADMIN);
      expect(user.status).toBe(UserStatus.ACTIVE);
      expect(user.eboardPosition).toBe(eboardPosition);
      // These seven share the seed password by design — they sign in with it
      // and reach /admin directly, unlike every other admin-provisioned
      // account (see prisma/seed.ts seedHardcodedAdmins).
      expect(user.mustChangePassword).toBe(false);
      expect(await verifyPassword(seedPassword, user.passwordHash)).toBe(true);
    }
  }, 30_000);

  it("re-running the seed after an officer's password has changed does not reset it", async () => {
    runSeed();
    const org = await prisma.org.findUniqueOrThrow({ where: { slug: "howard-nsbe" } });
    const email = HARDCODED_ADMINS[0].email;
    const realHash = await hashPassword("a-real-officer-password-not-the-seed-default");

    await prisma.user.update({
      where: { orgId_email: { orgId: org.id, email } },
      data: { passwordHash: realHash, mustChangePassword: true },
    });

    try {
      runSeed();

      const user = await prisma.user.findUniqueOrThrow({ where: { orgId_email: { orgId: org.id, email } } });
      expect(user.passwordHash).toBe(realHash);
      expect(user.mustChangePassword).toBe(true);
      // Role/position are still refreshed on every run — only the password path is protected.
      expect(user.role).toBe(Role.ADMIN);
      expect(user.eboardPosition).toBe(HARDCODED_ADMINS[0].eboardPosition);
    } finally {
      // This test's whole point is mutating a real seeded account's password
      // — undo it, or every later test/manual seed run in this same database
      // sees a "real" password instead of the seed default for this address.
      const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? "howard1867";
      await prisma.user.update({
        where: { orgId_email: { orgId: org.id, email } },
        data: { passwordHash: await hashPassword(seedPassword), mustChangePassword: false },
      });
    }
  }, 30_000);

  it("seeds Config.ADMIN_EMAIL_ALLOWLIST with all seven addresses by default", async () => {
    runSeed();
    const org = await prisma.org.findUniqueOrThrow({ where: { slug: "howard-nsbe" } });
    const config = await prisma.config.findUnique({
      where: { orgId_key: { orgId: org.id, key: "ADMIN_EMAIL_ALLOWLIST" } },
    });
    const allowlist = config?.value.split("|") ?? [];
    for (const { email } of HARDCODED_ADMINS) {
      expect(allowlist).toContain(email);
    }
  }, 30_000);
});
