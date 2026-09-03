import JoinWizard from "@/components/join/JoinWizard";
import { getCoreFormUiConfig, getOrgById } from "@/lib/repo";
import { requireOrgContext } from "@/lib/org";

export default async function JoinPage() {
  // Redirects to "/" if there's no org cookie yet (Part 6).
  const { orgId } = await requireOrgContext();
  const [org, config] = await Promise.all([getOrgById(orgId), getCoreFormUiConfig(orgId)]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
      <div className="text-center">
        <p className="text-sm text-muted">{org?.name ?? "Create your account"}</p>
        <h1 className="font-display text-2xl font-bold text-ink">Join</h1>
      </div>
      <JoinWizard config={config} />
    </main>
  );
}
