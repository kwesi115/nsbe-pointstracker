import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../_components/AccessDenied";
import AdminNav from "@/components/admin/AdminNav";
import TrashBin from "@/components/admin/TrashBin";
import { getTrash, runTrashSweep } from "@/lib/repo";

export default async function TrashPage() {
  const guard = await guardAdminPage({ level: "admin" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const orgId = guard.session.user.orgId;

  // The lazy expiry sweep, run BEFORE reading the bin (unlike /admin, which
  // defers it) so this page never lists an item that should already be gone.
  // Still rate-limited to once an hour, and a failure must not take the page
  // down with it — the bin itself is what an admin needs to see then.
  try {
    await runTrashSweep(orgId);
  } catch (err) {
    console.error("[trash] lazy sweep failed", err);
  }
  const trash = await getTrash(orgId);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Trash</h1>
        <p className="text-sm text-muted">
          Deleted accounts and events, kept for {trash.retentionDays} day{trash.retentionDays === 1 ? "" : "s"} before
          they&apos;re permanently deleted. Change that in Settings.
        </p>
      </div>
      <AdminNav active="/admin/trash" access={guard.access} />
      <TrashBin trash={trash} now={new Date()} />
    </main>
  );
}
