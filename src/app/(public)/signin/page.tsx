import SignInForm from "@/components/SignInForm";
import { getConfigValue, getOrgById } from "@/lib/repo";
import { requireOrgContext } from "@/lib/org";

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; email?: string; message?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  // Redirects to "/" if there's no org cookie yet (Part 6) — sign-in is
  // always org-scoped, never a bare (orgId-less) lookup.
  const { orgId } = await requireOrgContext();
  const [params, org, chapterName] = await Promise.all([
    searchParams,
    getOrgById(orgId),
    getConfigValue(orgId, "CHAPTER_NAME", "NSBE"),
  ]);
  const callbackUrl = params.callbackUrl || "/events";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <div>
        <p className="text-sm text-muted">{org?.name ?? chapterName}</p>
        <h1 className="font-display text-2xl font-bold text-ink">Points Tracker</h1>
      </div>

      {params.message ? (
        <p role="status" className="max-w-xs text-sm font-medium text-signal">
          {params.message}
        </p>
      ) : null}

      <SignInForm callbackUrl={callbackUrl} defaultEmail={params.email} />

      <p className="max-w-xs text-sm text-muted">
        New member?{" "}
        <a href="/join" className="font-semibold text-signal underline underline-offset-2">
          Create an account
        </a>
        .
      </p>
    </main>
  );
}
