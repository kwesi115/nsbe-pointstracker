/**
 * Strips Prisma-only connection-string query params (currently just
 * `schema`) before handing a DATABASE_URL to pg_dump/psql — libpq's URI
 * parser rejects unrecognized parameters outright ("invalid URI query
 * parameter"), and a full pg_dump/restore doesn't need Prisma's default
 * search_path hint anyway (pg_dump covers every schema in the database).
 */
export function pgConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}
