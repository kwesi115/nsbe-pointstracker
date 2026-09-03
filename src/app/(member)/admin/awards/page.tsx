import AdminNav from "@/components/admin/AdminNav";
import AwardsManager from "@/components/admin/AwardsManager";
import { getPointAwards } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";

export default async function AwardsPage() {
  const session = await requireAdmin();
  const awards = await getPointAwards(session.user.orgId);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Bonus awards</h1>
      <AdminNav active="/admin/awards" />
      <AwardsManager awards={awards} />
    </main>
  );
}
