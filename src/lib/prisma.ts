/**
 * Prisma Client singleton, wired to the pg driver adapter (Prisma 7 requires a
 * driver adapter for SQL providers — see prisma/schema.prisma).
 *
 * `prisma` is a Proxy, not a plain instance: touching a property is what
 * constructs the real client (validating DATABASE_URL via getRuntimeEnv()
 * along the way) and every property access forwards to the same cached
 * instance, so `import { prisma } from "@/lib/prisma"` stays a no-op at
 * import time. This module is imported transitively (via lib/repo.ts) by
 * every route, including during Vercel's build-time page-data collection —
 * a real construction there would either throw on a missing DATABASE_URL
 * (breaking the build) or silently hand pg an undefined connection string,
 * which falls back to pg's own localhost:5432 default and produces exactly
 * the "tries to reach 127.0.0.1:5432" failure this exists to prevent.
 * Deferring construction to first actual use means neither happens: the
 * build never touches a connection string, and a genuinely missing
 * DATABASE_URL fails loudly on the first real query instead of degrading
 * into a doomed connection attempt.
 *
 * Cached on globalThis in dev so Next's HMR doesn't open a fresh pool on
 * every reload; a plain module-scope variable suffices in production, since
 * the module itself is already cached per warm instance.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseUrl } from "@/lib/env";

declare global {
  var __prisma: PrismaClient | undefined;
}

let cachedClient: PrismaClient | undefined;

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma ??= createClient();
    return globalThis.__prisma;
  }
  cachedClient ??= createClient();
  return cachedClient;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});
