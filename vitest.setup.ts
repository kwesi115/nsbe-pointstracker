// DATABASE_URL lives in the root .env (see prisma.config.ts) — tests that hit
// the real Postgres instance (repo.test.ts, signup.test.ts, export tests)
// need it loaded before any module reads process.env.DATABASE_URL.
import "dotenv/config";
