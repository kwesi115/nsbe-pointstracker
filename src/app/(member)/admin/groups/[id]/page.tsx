import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../../_components/AccessDenied";
import Link from "next/link";
import { notFound } from "next/navigation";
import GroupDetail from "@/components/admin/GroupDetail";
import { getEventGroup, getEvents, getGroupAttendanceMatrix } from "@/lib/repo";

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPage({ level: "admin" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const { id } = await params;
  const orgId = session.user.orgId;

  const group = await getEventGroup(orgId, id);
  if (!group) notFound();

  const [allEvents, matrix] = await Promise.all([getEvents(orgId), getGroupAttendanceMatrix(orgId, id)]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <Link href="/admin/groups" className="text-sm text-muted hover:text-ink">
          ← Groups
        </Link>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">{group.name}</h1>
      </div>
      <GroupDetail group={group} allEvents={allEvents} matrix={matrix} />
    </main>
  );
}
