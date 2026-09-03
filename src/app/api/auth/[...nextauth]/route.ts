import { handlers } from "@/auth";

export const { GET, POST } = handlers;

// The session callback reads the workbook (repo.getRole()), which needs node:fs —
// this route can't run on the edge runtime.
export const runtime = "nodejs";
