/**
 * Fails loudly, once, on the first real request if a required runtime env
 * var is missing — instead of whichever module happens to touch it first
 * throwing a one-line, out-of-context error deep in a request. Deliberately
 * NOT imported from prisma.config.ts, next.config.ts, or anything else that
 * runs at build/config-load time: the build must succeed with none of these
 * set (see docs/DEPLOY.md and the postinstall `prisma generate` step, which
 * needs no database connection at all).
 */

const REQUIRED_RUNTIME_ENV = ["DATABASE_URL", "AUTH_SECRET", "CODE_SECRET"] as const;

let checked = false;

export function assertRequiredEnv(): void {
  if (checked) return;
  checked = true;

  const missing = REQUIRED_RUNTIME_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Set these in the Vercel project's Environment Variables (see .env.example for what each does).",
    );
  }
}
