import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";

/**
 * Renders wherever next/navigation's forbidden() is called (see
 * next.config.ts experimental.authInterrupts) — a real 403, not a generic
 * error boundary. Used for EBOARD_ONLY event access and /admin/leaderboard.
 */
export default function Forbidden() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <EmptyState
        icon={ShieldAlert}
        title="You don't have access to this"
        description="That page is restricted. If you think this is wrong, check with E-Board."
        action={
          <Link href="/dashboard" className="text-sm font-semibold text-signal underline underline-offset-2">
            Go to dashboard
          </Link>
        }
      />
    </main>
  );
}
