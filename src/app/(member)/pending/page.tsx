import { Clock, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import EmptyState from "@/components/ui/EmptyState";
import { AppError } from "@/lib/errors";
import { getConfigValue } from "@/lib/repo";
import { requireSession } from "@/lib/session";

export default async function PendingPage() {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
      redirect(`/signin?callbackUrl=${encodeURIComponent("/pending")}`);
    }
    throw err;
  }

  const chapterName = await getConfigValue(session.user.orgId, "CHAPTER_NAME", "NSBE");
  const suspended = session.user.status === "suspended";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <EmptyState
        icon={suspended ? ShieldAlert : Clock}
        title={suspended ? "Account suspended" : "Account pending"}
        description={
          suspended
            ? `Your account has been suspended. Contact ${chapterName} E-Board if you think this is a mistake.`
            : `Ask an E-Board member to check your account setup.`
        }
      />
      <p className="text-sm text-muted">You can still view your dashboard and the leaderboard while this is sorted out.</p>
    </main>
  );
}
