import { redirect } from "next/navigation";
import SetPasswordForm from "@/components/SetPasswordForm";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/session";

interface SetPasswordPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function SetPasswordPage({ searchParams }: SetPasswordPageProps) {
  const params = await searchParams;
  const callbackUrl = params.callbackUrl || "/events";

  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
      redirect(`/signin?callbackUrl=${encodeURIComponent("/set-password")}`);
    }
    throw err;
  }

  // Reachable only with a session flagged mustChangePassword — anyone else
  // (already fully set up) is sent on to where they were headed.
  if (!session.user.mustChangePassword) {
    redirect(callbackUrl);
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Choose a password</h1>
        <p className="max-w-sm text-sm text-muted">
          Set a real password to finish setting up your account. You won&apos;t be able to
          register for events until this is done.
        </p>
      </div>

      <SetPasswordForm callbackUrl={callbackUrl} />
    </main>
  );
}
