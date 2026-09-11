"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

/**
 * The admin safety net — for genuine crashes ONLY, not for access denials.
 *
 * A permission denial never reaches here: every /admin page calls
 * lib/access.ts guardAdminPage(), which RETURNS the denial so the page can
 * render <AccessDenied> from the server with the specific copy intact. That
 * indirection is not a style choice. Next.js strips the message and every
 * custom property (our AppError's `code` and `denial` included) off an error
 * thrown in a Server Component before it reaches this boundary in production,
 * leaving only `digest` — see node_modules/next/dist/docs/01-app/
 * 03-api-reference/03-file-conventions/error.md. So a boundary here CANNOT
 * tell a FORBIDDEN from a failed database call, and must not guess: rendering
 * "you don't have access" over a real outage would send someone hunting an
 * admin for a permission that was never the problem.
 *
 * Hence a plain error state. If this renders on an admin page, something
 * actually broke.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <ErrorState
        title="Something went wrong"
        description="That admin page didn't load. Try again, or head back if it keeps happening."
        onRetry={reset}
      />
    </main>
  );
}
