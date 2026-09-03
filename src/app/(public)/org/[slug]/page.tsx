import { notFound } from "next/navigation";
import { continueWithOrg } from "@/app/actions";
import { getOrgBySlug } from "@/lib/repo";

export default async function OrgLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org || !org.active) notFound();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-4">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white"
            style={{ backgroundColor: org.primaryColor || "var(--color-signal, #2f5fef)" }}
          >
            {org.shortName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <h1 className="font-display text-2xl font-bold text-ink">{org.name}</h1>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <form action={continueWithOrg.bind(null, org.id, "/signin")}>
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-signal px-4 text-sm font-semibold text-white hover:bg-[#2549c4]"
          >
            Sign in
          </button>
        </form>
        <form action={continueWithOrg.bind(null, org.id, "/join")}>
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-sunken"
          >
            Create an account
          </button>
        </form>
        <form action={continueWithOrg.bind(null, org.id, "/guest/join")}>
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold text-muted hover:text-ink"
          >
            Continue as a guest
          </button>
        </form>
      </div>
    </main>
  );
}
