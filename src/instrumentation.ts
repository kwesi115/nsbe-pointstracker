/**
 * Runs once per server instance, before the first request is handled (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 *
 * The one thing here is the development schema-drift warning. Schema gaps in
 * this project have twice been discovered as a broken page rather than as a
 * message — most recently a missing `setupCode` column that, through the
 * NextAuth session callback, took down every route in the app including the
 * public sign-in page. `next dev` is where that should be caught, and startup
 * is the moment a developer is actually looking at the terminal.
 */

export async function register() {
  // Node only: the Edge runtime has no fs and no pg socket, and proxy.ts
  // (which runs there) never touches the database anyway.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dev only. Production's guarantee is `prisma migrate deploy` in the build
  // script, which fails the build rather than logging — and a warning printed
  // to a serverless log nobody reads would be a false sense of coverage.
  if (process.env.NODE_ENV === "production") return;

  const { warnOnMigrationDrift } = await import("./lib/migration-drift");
  // Not awaited into the startup path on purpose: `register` must complete
  // before the server accepts requests, and a slow or unreachable database
  // must not delay `next dev` coming up. The warning lands when it lands.
  void warnOnMigrationDrift();
}
