import { redirect } from "next/navigation";
import SignupResume from "@/components/join/SignupResume";
import { AppError } from "@/lib/errors";
import { completeSignup, getCoreFormUiConfig, getOrgById, getSignupUser } from "@/lib/repo";
import { requireSession } from "@/lib/session";
import { missingSignupSteps, signupIsComplete } from "@/lib/signup";
import { DEFAULT_POST_SIGNUP_PATH, postSignupDestination } from "@/lib/signup-routes";

/**
 * Where an unfinished signup picks up.
 *
 * The resume point is DERIVED, here, on every request: missingSignupSteps reads
 * the member's row and returns the steps still unanswered, in wizard order. No
 * step index is stored anywhere, which is what makes this correct when the
 * profile was filled in somewhere else — on another device, at a check-in, or
 * by an admin from /admin/members/[id]. A stored position would have gone stale
 * the moment any of those wrote.
 *
 * This page and (member)/layout.tsx are a matched pair, and they read the SAME
 * value from the SAME place: the layout sends an incomplete signup here, this
 * page sends a complete one back. Because both derive from the row rather than
 * from a token, their conditions are exact complements and no loop is possible
 * — see lib/signup-routes.ts.
 */
export default async function ResumeSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
      // Nothing to resume without an account. /signin sends them back here if
      // the gate still applies once they're in.
      redirect("/signin");
    }
    throw err;
  }

  const { callbackUrl } = await searchParams;
  const destination = postSignupDestination(callbackUrl);

  const user = await getSignupUser(session.user.orgId, session.user.email);
  // No row for this session: nothing to complete, and the member layout will
  // deal with an account that has genuinely gone.
  if (!user) redirect(DEFAULT_POST_SIGNUP_PATH);

  // Already finished — including an account latched by the backfill, and one
  // that finished in another tab a second ago. Never show a completed member a
  // wizard.
  //
  // LATCH FIRST IF IT IS MISSING. The gate in (member)/layout.tsx reads the
  // latch alone (see auth.ts session callback, which selects seven columns and
  // cannot re-derive the full predicate). This page reads the predicate, which
  // is strictly weaker. The gap between them is exactly one row shape — profile
  // complete, latch null, which an admin filling in the last field by hand
  // produces — and without this write that row would bounce: the layout sends
  // it here, this page sends it back, forever. completeSignup() re-derives
  // requiredSignupFieldsComplete server-side before it writes, so it can only
  // latch a row that genuinely is finished, and it is idempotent. One write,
  // once, and the two guards agree from then on.
  if (signupIsComplete(user)) {
    if (!user.signupCompletedAt) {
      // Best-effort: if it fails the member still reaches `destination`, and
      // the worst case is that they pass through here again next request.
      await completeSignup(session.user.orgId, session.user.email).catch(() => {});
    }
    redirect(destination);
  }

  const [org, config] = await Promise.all([getOrgById(session.user.orgId), getCoreFormUiConfig(session.user.orgId)]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
      <div className="text-center">
        <p className="text-sm text-muted">{org?.name ?? "Finish setting up"}</p>
        <h1 className="font-display text-2xl font-bold text-foreground">Finish your account</h1>
        <p className="mt-2 text-sm text-muted">
          You&apos;re signed in as {session.user.email}. A few questions left before you can use the app.
        </p>
      </div>
      <SignupResume
        config={config}
        role={user.role}
        member={{
          firstName: user.firstName,
          lastName: user.lastName,
          studentId: user.studentId,
          classification: user.classification,
          major: user.major,
          majorOther: user.majorOther,
          phone: user.phone,
          personalEmail: user.personalEmail,
          tshirtSize: user.tshirtSize,
          duesPaidReported: user.duesPaidReported,
          nationalMemberReported: user.nationalMemberReported,
          nsbeMembershipId: user.nsbeMembershipId,
          house: user.house,
          resumeFileId: user.resumeFileId,
        }}
        initialMissingSteps={missingSignupSteps(user)}
        destination={destination}
      />
    </main>
  );
}
