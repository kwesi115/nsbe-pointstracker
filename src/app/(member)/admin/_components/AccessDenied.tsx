import Link from "next/link";
import type { AdminPageDenied } from "@/lib/access";
import { denialCopy } from "@/lib/access";
import Button from "@/components/ui/Button";

/**
 * What an admin surface renders instead of its content when the caller can't
 * use it — see lib/access.ts guardAdminPage, which every /admin page calls.
 *
 * This is a normal, expected outcome: an E-Board member clicked something that
 * isn't theirs, or followed a stale link. It is NOT a security incident, and
 * it must not look like one. So: no lock, no shield, no alert red, no "denied"
 * or "unauthorized" in the copy. The icon-free heading sits on the same muted
 * palette as EmptyState, because that is what this is — an empty state with a
 * reason attached.
 *
 * The body text names the specific requirement wherever the permission system
 * knows it (see denialCopy), so the reader knows what to ask an admin FOR
 * rather than being told a generic "admin-only".
 */
export default function AccessDenied({ denied }: { denied: AdminPageDenied }) {
  const { heading, body } = denialCopy(denied.denial);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center">
        <h1 className="font-display text-base font-bold text-ink">{heading}</h1>
        <p className="max-w-sm text-sm text-muted">{body}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {/* Omitted when /admin would deny them too — an action that leads
              straight into a second denial is worse than no action at all. */}
          {denied.canUseAdminHome ? (
            <Button href="/admin" variant="secondary">
              Back to admin
            </Button>
          ) : null}
          <Button href="/events" variant="secondary">
            Back to events
          </Button>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted">
        Wrong page?{" "}
        <Link href="/dashboard" className="underline underline-offset-2 hover:text-ink">
          Go to your dashboard
        </Link>
      </p>
    </main>
  );
}
