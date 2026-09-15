/**
 * `prisma migrate deploy`, retried — the first step of `npm run build`.
 *
 * WHY: Neon's free tier scales the compute to zero after a few minutes idle.
 * A Vercel deploy is very often the first thing to touch the database in
 * hours, so the build's migrate step pays for the cold start, and a resume
 * that runs long fails the whole deploy with P1002 ("the database server was
 * reached but timed out") before a single migration is even considered. That
 * is a transient infrastructure delay being reported as a build failure.
 *
 * WHAT IT DOES NOT DO: hide real migration failures. Only CONNECTION errors
 * are retried. A migration that reaches the database and fails to apply is a
 * fact about the schema, not about the network — retrying it gives a second,
 * more confusing error (the ledger now holds a failed row, so the next attempt
 * reports P3009 instead of the original cause) and delays the build by the
 * full backoff to reach the same conclusion. Those fail immediately, and every
 * path out of here that is not a success exits non-zero.
 *
 * Plain .mjs with no imports beyond node: builtins on purpose. It runs before
 * `next build` in an environment where the only thing guaranteed to have been
 * installed is what package.json declares — no tsx, no ts-node, no bundler.
 *
 * Deliberately NOT a substitute for connect_timeout=30 on DIRECT_URL (see
 * .env.example). That raises the ceiling on a single attempt; this one gives
 * the compute more than one chance to be awake. A cold start that needs 20s
 * needs the timeout; a compute that is still resuming when the first attempt
 * gives up needs the retry.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Prisma's own entry script, resolved through node_modules rather than trusted
 * to be on PATH. `npm run build` does put node_modules/.bin on PATH, but this
 * script is also runnable on its own (`npm run migrate:deploy`, or plain
 * `node scripts/migrate-deploy.mjs` while debugging a deploy) and bare
 * `prisma` is not found there. Running the .js entry with process.execPath
 * also sidesteps the Windows .cmd/.ps1 shim entirely, so no shell is needed.
 */
const PRISMA_ENTRY = createRequire(import.meta.url).resolve("prisma/build/index.js");

const ATTEMPTS = 3;
/** Backoff before attempts 2 and 3. Sized for a Neon resume, which is usually seconds, not minutes. */
const BACKOFF_MS = [5_000, 15_000];

/**
 * Prisma error codes that mean "never got to talk to the database".
 *   P1001  can't reach the server
 *   P1002  reached it, timed out          <- the Neon cold start
 *   P1008  operation timed out
 *   P1017  server closed the connection
 * Everything else — P3009 (failed migration in the ledger), P3018 (a migration
 * failed to apply), a schema error, a bad URL — is a real failure.
 */
const RETRYABLE = /\bP(1001|1002|1008|1017)\b/;

function run(args) {
  return new Promise((resolve) => {
    // Inherit stdout so Prisma's own output lands in the Vercel build log
    // verbatim; tee stderr so we can classify the failure afterwards while
    // still showing it live.
    const child = spawn(process.execPath, [PRISMA_ENTRY, ...args], { stdio: ["ignore", "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (err) => resolve({ code: 1, stderr: `${stderr}\n${err.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) console.log(`\n[migrate-deploy] attempt ${attempt} of ${ATTEMPTS}`);

    const { code, stderr } = await run(["migrate", "deploy"]);
    if (code === 0) {
      if (attempt > 1) console.log(`[migrate-deploy] succeeded on attempt ${attempt}.`);
      return 0;
    }

    if (!RETRYABLE.test(stderr)) {
      // A real migration or configuration failure. Say so plainly rather than
      // burning 20 seconds of backoff to fail the same way three times.
      console.error(
        "\n[migrate-deploy] failed, and not with a connection error — not retrying.\n" +
          "[migrate-deploy] This is a migration or configuration problem; the output above is the cause.",
      );
      return code;
    }

    if (attempt === ATTEMPTS) break;

    const wait = BACKOFF_MS[attempt - 1];
    console.error(
      `\n[migrate-deploy] could not connect (attempt ${attempt} of ${ATTEMPTS}). ` +
        `Neon may be resuming from zero; retrying in ${wait / 1000}s.`,
    );
    await sleep(wait);
  }

  console.error(
    `\n[migrate-deploy] still could not reach the database after ${ATTEMPTS} attempts. Failing the build.\n` +
      "[migrate-deploy] Check that DIRECT_URL is set, is the UNPOOLED endpoint (no \"-pooler\" in the host),\n" +
      "[migrate-deploy] and carries connect_timeout=30 — see .env.example.",
  );
  return 1;
}

main().then((code) => process.exit(code));
