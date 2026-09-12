"use client";

import { useState } from "react";
import {
  setHouseAction,
  setResumeAction,
  updateAboutAction,
  updateContactAction,
  updateMembershipAction,
} from "@/app/(public)/join/actions";
import Description from "@/components/forms/Description";
import FileDropField from "@/components/forms/FileDropField";
import HouseBlock from "@/components/forms/HouseBlock";
import YesNo from "@/components/forms/YesNo";
import Button from "@/components/ui/Button";
import Field, { inputClass, selectClass } from "@/components/ui/Field";
import { CLASSIFICATION_OPTIONS, OTHER_MAJOR, SHIRT_SIZE_OPTIONS, coreField } from "@/lib/core-form";
import type { House } from "@/lib/houses";
import type { StepKey } from "@/lib/signup";
import type { Classification, Role, ShirtSize } from "@/lib/types";
import { validateHouseStep } from "./joinWizardRules";

/**
 * The signup steps that collect profile data, shared by the two flows that
 * show them: JoinWizard.tsx (a new account, steps 4-8) and SignupResume.tsx
 * (an existing account finishing an abandoned signup).
 *
 * They live here rather than inside JoinWizard so the resume flow is literally
 * the same screens in the same order with the same progress indicator, not a
 * second implementation that drifts. Each one writes through the same Server
 * Action it always did, which is what makes resuming lose nothing: every step
 * has already persisted by the time the next one renders.
 */

/**
 * The profile fields these steps read and write — the subset of the wizard's
 * own draft that isn't about account creation. The wizard's Draft extends this
 * with its pre-account state (picker choice, join code, resolved role); the
 * resume flow seeds it from the member's row instead.
 */
export interface ProfileDraft {
  firstName: string;
  lastName: string;
  studentId: string;
  classification: Classification | "";
  major: string;
  majorOther: string;
  phone: string;
  personalEmail: string;
  tshirtSize: ShirtSize | "";
  duesPaid: boolean | undefined;
  nationalMember: boolean | undefined;
  nsbeMembershipId: string;
  houseSkipped: boolean;
  house: string;
  houseProofFileId: string | undefined;
  houseFilename: string | undefined;
  resumeFileId: string | undefined;
  resumeFilename: string | undefined;
  resumeSkipped: boolean;
}

export const STEP_LABEL: Record<StepKey, string> = {
  type: "Account type",
  code: "Join code",
  account: "Account",
  about: "About you",
  contact: "Contact",
  membership: "Membership",
  house: "NSBE House",
  resume: "Resume",
};

export function ProgressIndicator({ steps, currentIndex }: { steps: StepKey[]; currentIndex: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {steps.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i <= currentIndex ? "bg-signal" : "bg-line"}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <p className="text-xs font-medium text-muted">
        Step {currentIndex + 1} of {steps.length} · {STEP_LABEL[steps[currentIndex]]}
      </p>
    </div>
  );
}

export function StepCard({
  title,
  children,
  onBack,
}: {
  title: string;
  children: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-6">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      {children}
      {onBack ? (
        <button type="button" onClick={onBack} className="self-start text-sm font-semibold text-muted hover:text-ink">
          ← Back
        </button>
      ) : null}
    </div>
  );
}

/**
 * Shown when a profile-step action reports sessionExpired (see
 * requireWizardSession in join/actions.ts) — a plain retry can't fix a
 * missing session, so this offers a sign-in link instead. callbackUrl sends
 * the user straight back to /join, where the sessionStorage draft (still
 * intact — nothing here clears it) picks up at the same step.
 */
export function StepError({ message, sessionExpired }: { message: string; sessionExpired?: boolean }) {
  return (
    <div role="alert" className="flex flex-col gap-2 text-sm font-medium text-alert">
      <p>{message}</p>
      {sessionExpired ? (
        <a href="/signin?callbackUrl=%2Fjoin" className="self-start font-semibold text-signal underline underline-offset-2">
          Sign in again
        </a>
      ) : null}
    </div>
  );
}

export function ContactStep({
  draft,
  onPatch,
  onBack,
  onNext,
  isLastStep,
  onFinish,
}: {
  draft: ProfileDraft;
  onPatch: (f: Partial<ProfileDraft>) => void;
  onBack: () => void;
  onNext: () => void;
  isLastStep: boolean;
  onFinish: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  async function submit() {
    if (!draft.phone.trim() || !draft.personalEmail.trim()) {
      setError("Phone and personal email are required.");
      return;
    }
    setPending(true);
    setError(null);
    setSessionExpired(false);
    try {
      const result = await updateContactAction({
        phone: draft.phone,
        personalEmail: draft.personalEmail,
        tshirtSize: draft.tshirtSize || undefined,
      });
      if (result.error) {
        setError(result.error);
        setSessionExpired(Boolean(result.sessionExpired));
        return;
      }
      if (isLastStep) onFinish();
      else onNext();
    } catch {
      setError("Something went wrong saving your info. Your answers are safe — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <StepCard title="Contact" onBack={onBack}>
      <Field label="Phone" required>
        {(id) => (
          <input id={id} type="tel" value={draft.phone} onChange={(e) => onPatch({ phone: e.target.value })} className={inputClass} />
        )}
      </Field>
      <Field label="Personal email" required help={coreField("personalEmail").helpText}>
        {(id) => (
          <input
            id={id}
            type="email"
            value={draft.personalEmail}
            onChange={(e) => onPatch({ personalEmail: e.target.value })}
            className={inputClass}
          />
        )}
      </Field>
      <Field label="T-shirt size (optional)">
        {(id) => (
          <select
            id={id}
            value={draft.tshirtSize}
            onChange={(e) => onPatch({ tshirtSize: e.target.value as ShirtSize })}
            className={selectClass}
          >
            <option value="">Select…</option>
            {SHIRT_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </Field>
      {error ? <StepError message={error} sessionExpired={sessionExpired} /> : null}
      <Button type="button" onClick={submit} disabled={pending || sessionExpired}>
        {pending ? "Saving…" : isLastStep ? "Finish" : "Continue"}
      </Button>
    </StepCard>
  );
}

export function MembershipStep({
  draft,
  membershipSiteUrl,
  nationalMembershipUrl,
  onPatch,
  onBack,
  onNext,
}: {
  draft: ProfileDraft;
  membershipSiteUrl: string;
  nationalMembershipUrl: string;
  onPatch: (f: Partial<ProfileDraft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  async function submit() {
    if (draft.duesPaid === undefined || draft.nationalMember === undefined) {
      setError("Answer both questions to continue.");
      return;
    }
    setPending(true);
    setError(null);
    setSessionExpired(false);
    try {
      const result = await updateMembershipAction({
        duesPaid: draft.duesPaid,
        nationalMember: draft.nationalMember,
        nsbeMembershipId: draft.nsbeMembershipId || undefined,
      });
      if (result.error) {
        setError(result.error);
        setSessionExpired(Boolean(result.sessionExpired));
        return;
      }
      onNext();
    } catch {
      setError("Something went wrong saving your info. Your answers are safe — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <StepCard title="Membership" onBack={onBack}>
      <Field label="Have you paid your chapter dues?" required>
        {(id, describedBy) => (
          <div className="flex flex-col gap-2">
            <YesNo id={id} label="Dues paid" value={draft.duesPaid} onChange={(v) => onPatch({ duesPaid: v })} describedBy={describedBy} />
            <Description
              text="If no, pay through the [Howard NSBE Membership Website]({{membershipSiteUrl}})."
              vars={{ membershipSiteUrl }}
            />
          </div>
        )}
      </Field>
      <Field label="Are you a National NSBE member?" required>
        {(id, describedBy) => (
          <div className="flex flex-col gap-2">
            <YesNo
              id={id}
              label="National member"
              value={draft.nationalMember}
              onChange={(v) => onPatch({ nationalMember: v })}
              describedBy={describedBy}
            />
            <Description
              text="Not a member yet? Join or renew at [NSBE.org]({{nationalMembershipUrl}})."
              vars={{ nationalMembershipUrl }}
            />
          </div>
        )}
      </Field>
      {/*
        Its own field below the national question, not indented under it and
        not conditional on the answer — a member can hold an ID from a prior
        year, or have one pending, while answering No. Optional: the step's
        Continue gate (see submit above) never looks at it.
      */}
      <Field label={coreField("nsbeMembershipId").label} help={coreField("nsbeMembershipId").helpText}>
        {(id, describedBy) => (
          <input
            id={id}
            value={draft.nsbeMembershipId}
            onChange={(e) => onPatch({ nsbeMembershipId: e.target.value })}
            aria-describedby={describedBy}
            className={inputClass}
          />
        )}
      </Field>
      {error ? <StepError message={error} sessionExpired={sessionExpired} /> : null}
      <Button type="button" onClick={submit} disabled={pending || sessionExpired}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </StepCard>
  );
}

export function HouseStep({
  draft,
  houses,
  houseTestUrl,
  role,
  onPatch,
  onBack,
  onNext,
}: {
  draft: ProfileDraft;
  houses: House[];
  houseTestUrl: string;
  /**
   * Decides whether a screenshot is required (see lib/core-form.ts
   * houseSelfVerifies). Passed in rather than read off the draft: the wizard
   * knows it from the role its join code resolved to, the resume flow knows it
   * from the roster. Callers pass the role that requires the MOST when unsure
   * — the server re-derives it from the roster either way, so this is only ever
   * a UX affordance.
   */
  role: Role;
  onPatch: (f: Partial<ProfileDraft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  async function submit() {
    const validationError = validateHouseStep(
      {
        houseSkipped: draft.houseSkipped,
        house: draft.house,
        houseProofFileId: draft.houseProofFileId,
      },
      role,
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    setPending(true);
    setError(null);
    setSessionExpired(false);
    try {
      const result = await setHouseAction({
        // Always sent, never inferred from absent fields — the server
        // rejects a House step that carries no answer at all.
        houseSkipped: draft.houseSkipped,
        house: draft.houseSkipped ? undefined : draft.house || undefined,
        houseProofFileId: draft.houseSkipped ? undefined : draft.houseProofFileId,
      });
      if (result.error) {
        setError(result.error);
        setSessionExpired(Boolean(result.sessionExpired));
        return;
      }
    } catch {
      setError("Something went wrong saving your info. Your answers are safe — try again.");
      return;
    } finally {
      setPending(false);
    }
    onNext();
  }

  return (
    <StepCard title="NSBE House" onBack={onBack}>
      <HouseBlock
        houses={houses}
        houseTestUrl={houseTestUrl}
        role={role}
        value={{
          house: draft.house || undefined,
          houseProofFileId: draft.houseProofFileId,
          houseFilename: draft.houseFilename,
          houseSkipped: draft.houseSkipped,
        }}
        onChange={onPatch}
        disabled={pending}
      />
      {error ? <StepError message={error} sessionExpired={sessionExpired} /> : null}
      <Button type="button" onClick={submit} disabled={pending || sessionExpired}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </StepCard>
  );
}

export function ResumeStep({
  draft,
  onPatch,
  onBack,
  onFinish,
}: {
  draft: ProfileDraft;
  onPatch: (f: Partial<ProfileDraft>) => void;
  onBack: () => void;
  onFinish: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  async function submit() {
    if (draft.resumeFileId) {
      setPending(true);
      setError(null);
      setSessionExpired(false);
      try {
        const result = await setResumeAction(draft.resumeFileId);
        if (result.error) {
          setError(result.error);
          setSessionExpired(Boolean(result.sessionExpired));
          return;
        }
      } catch {
        setError("Something went wrong saving your info. Your answers are safe — try again.");
        return;
      } finally {
        setPending(false);
      }
    }
    onFinish();
  }

  return (
    <StepCard title="Resume" onBack={onBack}>
      <FileDropField
        label="Upload your resume (optional)"
        help="By uploading, you consent to Howard NSBE sharing it with employers for recruiting and professional opportunities."
        kind="resume"
        accept=".pdf,.doc,.docx"
        filename={draft.resumeFilename ?? null}
        onUploaded={(fileId, filename) => onPatch({ resumeFileId: fileId, resumeFilename: filename })}
        onClear={() => onPatch({ resumeFileId: undefined, resumeFilename: undefined })}
      />
      {error ? <StepError message={error} sessionExpired={sessionExpired} /> : null}
      <div className="flex gap-3">
        <Button type="button" onClick={submit} disabled={pending || sessionExpired}>
          {pending ? "Finishing…" : "Finish"}
        </Button>
        <Button type="button" variant="secondary" onClick={onFinish}>
          Do this later
        </Button>
      </div>
    </StepCard>
  );
}

/**
 * "About you" as a FORM rather than a review screen.
 *
 * JoinWizard's own AboutYouStep just confirms what AccountStep already
 * collected in the same submission, so it has nothing to write. The resume
 * flow cannot assume that: an account provisioned by an admin (see lib/repo.ts
 * createMemberAccount) or created by bulk import has an email and a name and
 * nothing else, so these fields genuinely are the resume point. Same fields,
 * same labels as AccountStep — minus email and password, which already exist.
 */
export function AboutFormStep({
  draft,
  majors,
  onPatch,
  onBack,
  onNext,
}: {
  draft: ProfileDraft;
  majors: string[];
  onPatch: (f: Partial<ProfileDraft>) => void;
  onBack?: () => void;
  onNext: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    setSessionExpired(false);
    try {
      const result = await updateAboutAction({
        firstName: draft.firstName,
        lastName: draft.lastName,
        studentId: draft.studentId,
        classification: draft.classification || undefined,
        major: draft.major || undefined,
        majorOther: draft.major === OTHER_MAJOR ? draft.majorOther : undefined,
      });
      if (result.error) {
        setError(result.error);
        setSessionExpired(Boolean(result.sessionExpired));
        return;
      }
      onNext();
    } catch {
      setError("Something went wrong saving your info. Your answers are safe — try again.");
      return;
    } finally {
      setPending(false);
    }
  }

  return (
    <StepCard title="About you" onBack={onBack}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name" required>
          {(id) => (
            <input id={id} value={draft.firstName} onChange={(e) => onPatch({ firstName: e.target.value })} className={inputClass} />
          )}
        </Field>
        <Field label="Last name" required>
          {(id) => (
            <input id={id} value={draft.lastName} onChange={(e) => onPatch({ lastName: e.target.value })} className={inputClass} />
          )}
        </Field>
      </div>
      <Field label="Student ID" required>
        {(id) => (
          <input id={id} value={draft.studentId} onChange={(e) => onPatch({ studentId: e.target.value })} className={inputClass} />
        )}
      </Field>
      <Field label="Classification" required>
        {(id) => (
          <select
            id={id}
            value={draft.classification}
            onChange={(e) => onPatch({ classification: e.target.value as Classification })}
            className={selectClass}
          >
            <option value="" disabled>
              Select…
            </option>
            {CLASSIFICATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Major" required>
        {(id) => (
          <select id={id} value={draft.major} onChange={(e) => onPatch({ major: e.target.value })} className={selectClass}>
            <option value="" disabled>
              Select…
            </option>
            {majors.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={OTHER_MAJOR}>{OTHER_MAJOR}</option>
          </select>
        )}
      </Field>
      {draft.major === OTHER_MAJOR ? (
        <Field label="Your major" required>
          {(id) => (
            <input id={id} value={draft.majorOther} onChange={(e) => onPatch({ majorOther: e.target.value })} className={inputClass} />
          )}
        </Field>
      ) : null}
      {error ? <StepError message={error} sessionExpired={sessionExpired} /> : null}
      <Button type="button" onClick={submit} disabled={pending || sessionExpired}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </StepCard>
  );
}
