import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../_components/AccessDenied";
import AdminNav from "@/components/admin/AdminNav";
import AwardsManager from "@/components/admin/AwardsManager";
import { getPointAwards } from "@/lib/repo";

export default async function AwardsPage() {
  const guard = await guardAdminPage({ level: "admin" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const awards = await getPointAwards(session.user.orgId);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Bonus awards</h1>
      <AdminNav active="/admin/awards" access={guard.access} />
      <AwardsManager awards={awards} />
    </main>
  );
}
