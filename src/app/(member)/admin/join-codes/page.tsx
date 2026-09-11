import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../_components/AccessDenied";
import AdminNav from "@/components/admin/AdminNav";
import JoinCodesManager from "@/components/admin/JoinCodesManager";
import { listJoinCodes } from "@/lib/repo";

export default async function AdminJoinCodesPage() {
  const guard = await guardAdminPage({ level: "admin" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const codes = await listJoinCodes(session.user.orgId);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Join codes</h1>
        <p className="text-sm text-muted">
          Admin-only. The code is the whole security model — whoever submits a valid code gets exactly the role it
          grants, regardless of what they picked on the way in. Rotate the General code every semester; rotate
          E-Board/Admin codes on handoff.
        </p>
      </div>
      <AdminNav active="/admin/join-codes" access={guard.access} />
      <JoinCodesManager codes={codes} />
    </main>
  );
}
