import Link from "next/link";
import AdminNav from "@/components/admin/AdminNav";
import NewGroupForm from "@/components/admin/NewGroupForm";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { getEventGroups } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";

export default async function GroupsPage() {
  const session = await requireAdmin();
  const groups = await getEventGroups(session.user.orgId);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">NSBE Week / event groups</h1>
      <AdminNav active="/admin/groups" />
      <p className="text-sm text-muted">
        A set of events whose completion bonus is calculated only after the final event closes — see lib/points.ts
        groupBonusFor.
      </p>

      {groups.length === 0 ? (
        <EmptyState title="No groups yet" description="Create one to start assigning events to it." />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <Link key={g.id} href={`/admin/groups/${g.id}`} className="block rounded-xl focus-visible:outline-offset-4">
              <Card className="transition-colors hover:border-signal">
                <p className="font-display text-base font-bold text-ink">{g.name}</p>
                <p className="text-sm text-muted">
                  {g.eventIds.length} of {g.expectedEventCount} events · {g.finalizedAt ? "Finalized" : "Not finalized"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <NewGroupForm />
    </main>
  );
}
