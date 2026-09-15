import { handlers } from "@/auth";

export const { GET, POST } = handlers;

// The session callback queries Postgres through the pg driver adapter
// (repo.getSessionUser()), which needs node:net — this route can't run on the
// edge runtime.
export const runtime = "nodejs";
