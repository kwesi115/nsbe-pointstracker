"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeSignupAction } from "@/app/(public)/join/actions";
import { signOutAction } from "@/app/(member)/actions";
import Button from "@/components/ui/Button";
import type { House } from "@/lib/houses";
import { signupStepsFor, type StepKey } from "@/lib/signup";
import type { Classification, Role, ShirtSize } from "@/lib/types";
import {
  AboutFormStep,
  ContactStep,
  HouseStep,
  MembershipStep,
  ProgressIndicator,
  ResumeStep,
  StepCard,
  StepError,
  type ProfileDraft,
} from "./steps";

/** The profile fields the page hands over, straight off the member's row. */
export interface ResumeMember {
  firstName: string;
  lastName: string;
  studentId: string;
  classification: Classification | "";
  major: string;
  majorOther: string;
  phone: string;
  personalEmail: string;
  tshirtSize: ShirtSize | "";
  duesPaidReported: boolean | null;
  nationalMemberReported: boolean | null;
  nsbeMembershipId: string;
  house: string;
  resumeFileId: string | null;
}

export interface SignupResumeConfig {
  majors: string[];
  houses: House[];
  membershipSiteUrl: string;
  houseTestUrl: string;
  nationalMembershipUrl: string;
}

/**
 * The back half of the join wizard, for an account that already exists.
 *
 * Same step components, same order, same progress indicator as JoinWizard — the
 * numbering is computed against the FULL step list for the member's role
 * (lib/signup.ts signupStepsFor), so "Step 5 of 8" means the same thing it
 * meant first time through rather than "step 1 of the 3 you have left".
 *
 * The steps themselves are unchanged in another way that matters: each one
 * still writes through its own Server Action as it completes. So a member who
 * abandons this flow too has lost nothing, and the next visit derives a shorter
 * list. There is no step index in this component's state that survives a
 * reload, and none on the server.
 */
export default function SignupResume({
  config,
  role,
  member,
  initialMissingSteps,
  destination,
}: {
  config: SignupResumeConfig;
  role: Role;
  member: ResumeMember;
  /** Derived on the server from the row — see lib/signup.ts missingSignupSteps. */
  initialMissingSteps: StepKey[];
  /** Where to go once the latch is set: the original callbackUrl, or /events. */
  destination: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProfileDraft>({
    firstName: member.firstName,
    lastName: member.lastName,
    studentId: member.studentId,
    classification: member.classification,
    major: member.major,
    majorOther: member.majorOther,
    phone: member.phone,
    personalEmail: member.personalEmail,
    tshirtSize: member.tshirtSize,
    // Reported values are tri-state on the row and on the form both, so a
    // member who answered "no" first time sees "no" selected, not a blank.
    duesPaid: member.duesPaidReported ?? undefined,
    nationalMember: member.nationalMemberReported ?? undefined,
    nsbeMembershipId: member.nsbeMembershipId,
    houseSkipped: false,
    house: member.house,
    houseProofFileId: undefined,
    houseFilename: undefined,
    resumeFileId: member.resumeFileId ?? undefined,
    resumeFilename: undefined,
    resumeSkipped: false,
  });

  // The remaining steps, as derived by the server for this render. Advancing is
  // local to the visit; the durable record is the profile data each step wrote,
  // which is what the next visit re-derives from.
  const [remaining] = useState<StepKey[]>(initialMissingSteps);
  const [cursor, setCursor] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSteps = signupStepsFor(role);
  const step = remaining[Math.min(cursor, remaining.length - 1)];

  function patch(fields: Partial<ProfileDraft>) {
    setDraft((d) => ({ ...d, ...fields }));
  }

  /**
   * Finish, or move to the next outstanding step.
   *
   * `houseSkipped` has to be carried to the server here because the skip writes
   * nothing to the row by design (see lib/repo.ts clearHouseAssignment) — it is
   * the one answer that cannot be re-derived, and completeSignup takes it on
   * the same trust join/actions.ts setHouseAction always has.
   */
  async function advance() {
    if (cursor < remaining.length - 1) {
      setCursor((c) => c + 1);
      return;
    }
    setFinishing(true);
    setError(null);
    try {
      const result = await completeSignupAction({ houseSkipped: draft.houseSkipped, callbackUrl: destination });
      if (result.error || !result.destination) {
        setError(result.error ?? "Something is still missing. Check the steps above.");
        return;
      }
      router.push(result.destination);
    } catch {
      setError("Something went wrong finishing your account. Your answers are saved — try again.");
    } finally {
      setFinishing(false);
    }
  }

  function goBack() {
    setCursor((c) => Math.max(c - 1, 0));
  }

  // Nothing outstanding: the server already redirects this case, so reaching it
  // here means the last step just completed and the latch is being set.
  if (!step) {
    return (
      <StepCard title="Finishing up…">
        <p className="text-sm text-muted">One moment.</p>
      </StepCard>
    );
  }

  const position = allSteps.indexOf(step);

  return (
    <div className="flex flex-col gap-6">
      <ProgressIndicator steps={allSteps} currentIndex={position === -1 ? allSteps.length - 1 : position} />

      {step === "about" && (
        <AboutFormStep
          draft={draft}
          majors={config.majors}
          onPatch={patch}
          onBack={cursor > 0 ? goBack : undefined}
          onNext={advance}
        />
      )}

      {step === "contact" && (
        <ContactStep
          draft={draft}
          onPatch={patch}
          onBack={goBack}
          onNext={advance}
          isLastStep={cursor === remaining.length - 1}
          onFinish={advance}
        />
      )}

      {step === "membership" && (
        <MembershipStep
          draft={draft}
          membershipSiteUrl={config.membershipSiteUrl}
          nationalMembershipUrl={config.nationalMembershipUrl}
          onPatch={patch}
          onBack={goBack}
          onNext={advance}
        />
      )}

      {step === "house" && (
        <HouseStep
          draft={draft}
          houses={config.houses}
          houseTestUrl={config.houseTestUrl}
          role={role}
          onPatch={patch}
          onBack={goBack}
          onNext={advance}
        />
      )}

      {step === "resume" && <ResumeStep draft={draft} onPatch={patch} onBack={goBack} onFinish={advance} />}

      {error ? <StepError message={error} /> : null}

      <FinishLater pending={finishing} />
    </div>
  );
}

/**
 * The way out.
 *
 * A member with no exit from a half-finished signup abandons the account
 * altogether, so this signs them out cleanly and returns them to the org
 * landing page — everything they have answered so far is already saved, and
 * signing back in resumes at the same place. It deliberately does NOT let them
 * into the app: an incomplete profile is the thing the gate exists to prevent.
 */
function FinishLater({ pending }: { pending: boolean }) {
  return (
    // signOutAction is the app's one sign-out (it clears the guest pass and
    // lands on the org landing, keeping the org selection) — the exit needs
    // nothing more, because every step has already saved as it completed.
    <form action={signOutAction} className="flex flex-col items-center gap-1.5 border-t border-line pt-5">
      <Button type="submit" variant="ghost" disabled={pending} className="text-sm">
        Finish this later
      </Button>
      <p className="max-w-sm text-center text-xs text-muted">
        We&apos;ll save what you&apos;ve answered and sign you out. Sign in any time to pick up where you left off.
      </p>
    </form>
  );
}
