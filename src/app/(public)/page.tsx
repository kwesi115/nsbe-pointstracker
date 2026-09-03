import { redirect } from "next/navigation";
import { continueWithOrg } from "@/app/actions";
import { getOrgIdFromCookie } from "@/lib/org";
import { getActiveOrgs, getOrgById } from "@/lib/repo";

export default async function HomePage() {
  // Returning visitor: the cookie already resolves to an active org, so skip
  // straight past the picker (Part 2).
  const cookieOrgId = await getOrgIdFromCookie();
  if (cookieOrgId) {
    const org = await getOrgById(cookieOrgId);
    if (org?.active) redirect(`/org/${org.slug}`);
  }

  const orgs = await getActiveOrgs();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Select your chapter.</h1>
      </div>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        {orgs.map((org) => (
          <form key={org.id} action={continueWithOrg.bind(null, org.id, `/org/${org.slug}`)}>
            <button
              type="submit"
              className="flex w-full flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-10 text-center transition-colors hover:border-signal hover:bg-surface-sunken"
            >
              {org.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={org.logoUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white"
                  style={{ backgroundColor: org.primaryColor || "var(--color-signal, #2f5fef)" }}
                >
                  {org.shortName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="font-display text-lg font-bold text-ink">{org.name}</span>
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
