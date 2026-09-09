import { z } from "zod";

/**
 * Every environment variable the running app (not the build, not the
 * seed/backup/restore CLI scripts) needs to serve a single request.
 * Validated lazily, on first call — NEVER at module scope, and never
 * imported from prisma.config.ts or next.config.ts. Vercel's build
 * (postinstall's `prisma generate`, then `next build`) runs with no secrets
 * guaranteed, so this must only ever run once a real request is being served.
 *
 * A missing/empty var reports here, not as a Postgres connection error or an
 * opaque crypto failure three modules away.
 *
 * getDatabaseUrl() is deliberately separate from getRuntimeEnv(): src/lib/prisma.ts
 * depends on ONLY DATABASE_URL to construct a client — it must not also demand
 * AUTH_SECRET/CODE_SECRET, or every DB-only code path (tests, scripts, a future
 * isolated worker) would fail on secrets it never uses. getRuntimeEnv() is the
 * full blanket check src/proxy.ts runs on (almost) every request.
 */
const runtimeEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is not set"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is not set"),
  CODE_SECRET: z.string().min(1, "CODE_SECRET is not set"),
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

let cached: RuntimeEnv | undefined;

function fail(missing: string[]): never {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(", ")}. ` +
      "Set these in the Vercel project's Environment Variables (see .env.example for what each does).",
  );
}

/** Validates and returns every required runtime env var, memoized after the first successful call. */
export function getRuntimeEnv(): RuntimeEnv {
  if (cached) return cached;

  const result = runtimeEnvSchema.safeParse(process.env);
  if (!result.success) {
    fail([...new Set(result.error.issues.map((issue) => String(issue.path[0])))]);
  }

  cached = result.data;
  return cached;
}

/** Same validation, called purely for its throw — see src/proxy.ts, which doesn't need the values themselves. */
export function assertRequiredEnv(): void {
  getRuntimeEnv();
}

const databaseUrlSchema = z.string().min(1, "DATABASE_URL is not set");

let cachedDatabaseUrl: string | undefined;

/** The one var src/lib/prisma.ts actually needs — validated on its own, not bundled with unrelated app secrets. */
export function getDatabaseUrl(): string {
  if (cachedDatabaseUrl) return cachedDatabaseUrl;

  const result = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!result.success) fail(["DATABASE_URL"]);

  cachedDatabaseUrl = result.data;
  return cachedDatabaseUrl;
}
