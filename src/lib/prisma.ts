/**
 * Prisma Client singleton, wired to the pg driver adapter (Prisma 7 requires a
 * driver adapter for SQL providers — see prisma/schema.prisma). Cached on
 * globalThis in dev so Next's HMR doesn't open a fresh pool on every reload.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalThis.__prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
