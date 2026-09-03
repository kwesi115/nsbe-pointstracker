// Applies a raw .sql file to DATABASE_URL inside a single transaction.
//
// Prisma's schema-engine binary (needed by `prisma migrate dev`/`db push`) is
// blocked by this machine's Windows Application Control policy, so schema
// changes are written as plain SQL under prisma/migrations/<name>/migration.sql
// and applied with this script instead of the Prisma CLI.
//
// Usage: dotenv -e .env -- tsx scripts/db-apply-sql.ts prisma/migrations/0001_init/migration.sql
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: tsx scripts/db-apply-sql.ts <path-to-sql-file>");
    process.exit(1);
  }
  const sql = readFileSync(file, "utf8");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(`Applied ${file}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
