import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../../_components/AccessDenied";
import Link from "next/link";
import CategoriesManager from "@/components/admin/CategoriesManager";
import { getEventCategories } from "@/lib/repo";

export default async function CategoriesSettingsPage() {
  const guard = await guardAdminPage({ level: "admin" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const categories = await getEventCategories(session.user.orgId);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <Link href="/admin/settings" className="text-sm text-muted hover:text-ink">
          ← Settings
        </Link>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">Event categories</h1>
        <p className="text-sm text-muted">
          Replaces the old flat point system — tier, point value, and eligibility for every kind of event, editable
          with no deploy.
        </p>
      </div>
      <CategoriesManager categories={categories} exportsEnabled={guard.access.features.exports} />
    </main>
  );
}
