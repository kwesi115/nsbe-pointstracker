import AdminNav from "@/components/admin/AdminNav";
import VerificationQueue from "@/components/admin/VerificationQueue";
import { getDuesPendingMembers, getHousePendingMembers, getNationalPendingMembers } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

export default async function AdminVerificationsPage() {
  const session = await requireEboard();
  const orgId = session.user.orgId;
  const [dues, national, house] = await Promise.all([
    getDuesPendingMembers(orgId),
    getNationalPendingMembers(orgId),
    getHousePendingMembers(orgId),
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
      <AdminNav active="/admin/verifications" />

      <p className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm text-ink">
        Members are on the leaderboard as soon as they report Yes — this queue confirms claims after the fact.
      </p>

      <VerificationQueue dues={dues} national={national} house={house} />
    </main>
  );
}
