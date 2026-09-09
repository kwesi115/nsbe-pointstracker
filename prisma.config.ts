import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma/config`'s env() throws the instant this file is evaluated if the
    // var is unset — that ran even for `prisma generate`, which needs no
    // connection at all, breaking Vercel's postinstall before DIRECT_URL was
    // ever needed. Read directly instead so a missing value resolves to
    // undefined (fine for generate) rather than a config-load crash; only
    // `migrate`/`db push` actually dereference this url, and they still fail
    // with Prisma's own clear error if it's genuinely missing.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
