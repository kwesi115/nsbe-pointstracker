import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../_components/AccessDenied";
import Link from "next/link";
import AdminNav from "@/components/admin/AdminNav";
import VerificationQueue from "@/components/admin/VerificationQueue";
import {
  getDuesPendingMembers,
  getHouseMissingMembers,
  getHousePendingMembers,
  getNationalPendingMembers,
} from "@/lib/repo";
import { isEboardOrAdmin } from "@/lib/session";

export default async function AdminVerificationsPage() {
  const guard = await guardAdminPage({ level: "permission", permission: "verifications_write" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const orgId = session.user.orgId;
  const [dues, national, house, houseMissing] = await Promise.all([
    getDuesPendingMembers(orgId),
    getNationalPendingMembers(orgId),
    getHousePendingMembers(orgId),
    getHouseMissingMembers(orgId),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Membership audit</h1>
        <p className="text-sm text-muted">
          Dues, National NSBE membership, and House assignments members have self-reported, spot-checked against the
          real record.
        </p>
      </div>
      {isEboardOrAdmin(session.user.role) ? (
        <AdminNav active="/admin/verifications" access={guard.access} />
      ) : (
        <p className="text-xs text-muted">
          You have access to this page only — granted by an Admin. <a href="/dashboard" className="underline underline-offset-2">Back to dashboard</a>
        </p>
      )}

      <p className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm text-ink">
        Members are on the leaderboard as soon as they report Yes — this queue confirms claims after the fact.
      </p>

      <VerificationQueue dues={dues} national={national} house={house} />

      {/* The House tab can only show Houses that were actually submitted. An
          account that never answered the House step has nothing to review
          and would never appear anywhere — which is exactly how House-less
          accounts went unnoticed. Surfaced here, next to the queue an admin
          already works through, rather than left to be found by accident. */}
      {houseMissing.length > 0 ? (
        <p className="rounded-lg border border-amber bg-amber/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">
            {houseMissing.length} account{houseMissing.length === 1 ? " has" : "s have"} no House on file.
          </span>{" "}
          They&apos;re asked again at their next check-in and on their account page, but nothing here can review a House
          that was never submitted.{" "}
          <Link href="/admin/members?house=missing" className="underline underline-offset-2">
            See who
          </Link>
          .
        </p>
      ) : null}
    </main>
  );
}
