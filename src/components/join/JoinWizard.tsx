"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkJoinCodeAction,
  createAccountAction,
  setHouseAction,
  setResumeAction,
  updateContactAction,
  updateMembershipAction,
  type CheckJoinCodeState,
  type CreateAccountState,
} from "@/app/(public)/join/actions";
import Description from "@/components/forms/Description";
import FileDropField from "@/components/forms/FileDropField";
import HouseBlock from "@/components/forms/HouseBlock";
import YesNo from "@/components/forms/YesNo";
import Button from "@/components/ui/Button";
import Field, { inputClass, selectClass } from "@/components/ui/Field";
import { CLASSIFICATION_OPTIONS, OTHER_MAJOR, coreField } from "@/lib/core-form";
import type { House } from "@/lib/houses";
import type { Classification, Role, ShirtSize } from "@/lib/types";
import { stepsFor, validateHouseStep, type StepKey } from "./joinWizardRules";

const ACCOUNT_TYPES: Array<{ value: "general" | "eboard" | "admin"; label: string; description: string }> = [
  { value: "general", label: "General member", description: "The account most members create — announced at GBMs." },
  { value: "eboard", label: "E-Board", description: "Requires a code from a current admin." },
  { value: "admin", label: "Admin", description: "Requires a code from a current admin." },
];

const SHIRT_SIZES: ShirtSize[] = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

const ROLE_COPY: Record<Role, string> = {
  admin: "That code creates an admin account.",
  eboard: "That code creates an E-Board account.",
  general: "That code creates a general member account.",
  guest: "That code creates a general member account.",
};

const ACCOUNT_TYPE_LABEL: Record<Role, string> = {
  admin: "Admin",
  eboard: "E-Board",
  general: "General member",
  guest: "General member",
};

const STEP_LABEL: Record<StepKey, string> = {
  type: "Account type",
  code: "Join code",
  account: "Account",
  about: "About you",
  contact: "Contact",
  membership: "Membership",
  house: "NSBE House",
  resume: "Resume",
};

interface Draft {
  accountType: "general" | "eboard" | "admin" | null;
  code: string;
  resolvedRole: Role | null;
  email: string;
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
  accountCreated: boolean;
}

const EMPTY_DRAFT: Draft = {
  accountType: null,
  code: "",
  resolvedRole: null,
  email: "",
  firstName: "",
  lastName: "",
  studentId: "",
  classification: "",
  major: "",
  majorOther: "",
  phone: "",
  personalEmail: "",
  tshirtSize: "",
  duesPaid: undefined,
  nationalMember: undefined,
  nsbeMembershipId: "",
  houseSkipped: false,
  house: "",
  houseProofFileId: undefined,
  houseFilename: undefined,
  resumeFileId: undefined,
  resumeFilename: undefined,
  resumeSkipped: false,
  accountCreated: false,
};

const STORAGE_KEY = "join-wizard-draft";

export interface JoinWizardConfig {
  majors: string[];
  houses: House[];
  membershipSiteUrl: string;
  houseTestUrl: string;
  nationalMembershipUrl: string;
}

export default function JoinWizard({ config }: { config: JoinWizardConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [stepIndex, setStepIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  // Persist non-secret wizard state so a validation failure deep in the
  // wizard (Part 4: "a validation failure on step 8 doesn't lose steps 4–6")
  // never loses earlier answers. Password is intentionally never persisted.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { draft: Draft; stepIndex: number };
        setDraft((d) => ({ ...d, ...parsed.draft }));
        setStepIndex(parsed.stepIndex ?? 0);
      }
    } catch {
      // Corrupt/blocked storage — start fresh rather than blocking signup.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ draft, stepIndex }));
    } catch {
      // Ignore — sessionStorage is a convenience, not a requirement.
    }
  }, [draft, stepIndex, hydrated]);

  const steps = stepsFor(draft.accountType, draft.resolvedRole);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  function patch(fields: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...fields }));
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function finish() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
    router.push("/events");
  }

  return (
    <div className="flex flex-col gap-6">
      <ProgressIndicator steps={steps} currentIndex={Math.min(stepIndex, steps.length - 1)} />

      {step === "type" && (
        <AccountTypeStep
          value={draft.accountType}
          onSelect={(v) => {
            // General needs no code — resolve the role right here, straight
            // from the picker, and skip step 2 entirely (stepsFor already
            // drops "code" once accountType === "general"). Switching AWAY
            // from general must clear a stale resolvedRole from a prior
            // pick, or the wizard would wrongly skip Membership/House/Resume
            // for someone who's now going through the code step for real.
            patch({ accountType: v, resolvedRole: v === "general" ? "general" : null });
            goNext();
          }}
        />
      )}

      {step === "code" && (
        <JoinCodeStep
          accountType={draft.accountType}
          code={draft.code}
          onCodeChange={(code) => patch({ code })}
          onBack={goBack}
          onResolved={(resolvedRole) => {
            patch({ resolvedRole });
            goNext();
          }}
        />
      )}

      {step === "account" && (
        <AccountStep
          draft={draft}
          majors={config.majors}
          onBack={goBack}
          onCreated={(email, grantsRole) => {
            // resolvedRole becomes authoritative here — the DB-confirmed
            // role the account actually got, which may differ from what
            // step 2 previewed (e.g. a code that got exhausted in between)
            // or from what a codeless "general" pick assumed.
            patch({ email, accountCreated: true, resolvedRole: grantsRole });
            // An ADMIN signup ends here — the account step is its last one
            // (see stepsFor), so finish rather than advancing into a step
            // that doesn't exist. Everything below is computed against the
            // step list the CONFIRMED role produces, not `steps`, which is
            // still the pre-patch list on this render: goNext() would clamp
            // against the old length and could land back on this same step
            // when the list grows (a code that previewed ADMIN but granted
            // GENERAL), re-showing a form whose account already exists.
            const next = stepsFor(draft.accountType, grantsRole);
            const accountIndex = next.indexOf("account");
            if (accountIndex === next.length - 1) finish();
            else setStepIndex(accountIndex + 1);
          }}
        />
      )}

      {step === "about" && <AboutYouStep draft={draft} onPatch={patch} onBack={goBack} onNext={goNext} />}

      {step === "contact" && (
        <ContactStep draft={draft} onPatch={patch} onBack={goBack} onNext={goNext} isLastStep={steps[steps.length - 1] === "contact"} onFinish={finish} />
      )}

      {step === "membership" && (
        <MembershipStep
          draft={draft}
          membershipSiteUrl={config.membershipSiteUrl}
          nationalMembershipUrl={config.nationalMembershipUrl}
          onPatch={patch}
          onBack={goBack}
          onNext={goNext}
        />
      )}

      {step === "house" && (
        <HouseStep draft={draft} houses={config.houses} houseTestUrl={config.houseTestUrl} onPatch={patch} onBack={goBack} onNext={goNext} />
      )}

      {step === "resume" && <ResumeStep draft={draft} onPatch={patch} onBack={goBack} onFinish={finish} />}
    </div>
  );
}

function ProgressIndicator({ steps, currentIndex }: { steps: StepKey[]; currentIndex: number }) {
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

function StepCard({
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

function AccountTypeStep({
  value,
  onSelect,
}: {
  value: Draft["accountType"];
  onSelect: (v: "general" | "eboard" | "admin") => void;
}) {
  return (
    <StepCard title="What kind of account?">
      <div className="flex flex-col gap-3">
        {ACCOUNT_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onSelect(t.value)}
            className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-colors ${
              value === t.value ? "border-signal bg-signal/5" : "border-line bg-white hover:bg-surface-sunken"
            }`}
          >
            <span className="text-sm font-semibold text-ink">{t.label}</span>
            <span className="text-xs text-muted">{t.description}</span>
          </button>
        ))}
      </div>
    </StepCard>
  );
}

const CHECK_CODE_INITIAL: CheckJoinCodeState = { error: null, grantsRole: null, label: null };

function JoinCodeStep({
  accountType,
  code,
  onCodeChange,
  onBack,
  onResolved,
}: {
  accountType: Draft["accountType"];
  code: string;
  onCodeChange: (v: string) => void;
  onBack: () => void;
  onResolved: (role: Role) => void;
}) {
  const [state, formAction, pending] = useActionState(checkJoinCodeAction, CHECK_CODE_INITIAL);

  useEffect(() => {
    if (state.grantsRole) onResolved(state.grantsRole);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.grantsRole]);

  return (
    <StepCard title="Enter your join code" onBack={onBack}>
      <p className="text-sm text-muted">
        You picked <strong className="text-ink">{accountType}</strong>. The code you enter — not this choice —
        decides the account you get.
      </p>
      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Join code" required error={state.error}>
          {(id, describedBy) => (
            <input
              id={id}
              name="code"
              value={code}
              onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
              disabled={pending}
              aria-describedby={describedBy}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              placeholder="XXXXXXXX"
              className="min-h-16 w-full rounded-xl border border-line bg-white px-4 text-center font-display text-3xl font-bold uppercase tracking-[0.3em] text-ink placeholder:text-line focus-visible:border-signal disabled:opacity-50"
            />
          )}
        </Field>
        <Button type="submit" disabled={pending || code.trim().length === 0}>
          {pending ? "Checking…" : "Continue"}
        </Button>
      </form>
    </StepCard>
  );
}

const CREATE_ACCOUNT_INITIAL: CreateAccountState = { error: null, ok: false, grantsRole: null };

function AccountStep({
  draft,
  majors,
  onBack,
  onCreated,
}: {
  draft: Draft;
  majors: string[];
  onBack: () => void;
  onCreated: (email: string, grantsRole: Role) => void;
}) {
  const [state, formAction, pending] = useActionState(createAccountAction, CREATE_ACCOUNT_INITIAL);
  const [email, setEmail] = useState(draft.email);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState(draft.firstName);
  const [lastName, setLastName] = useState(draft.lastName);
  const [studentId, setStudentId] = useState(draft.studentId);
  const [classification, setClassification] = useState<Classification | "">(draft.classification);
  const [major, setMajor] = useState(draft.major);
  const [majorOther, setMajorOther] = useState(draft.majorOther);
  const errors = state.fieldErrors ?? {};

  const router = useRouter();
  useEffect(() => {
    if (state.ok && state.grantsRole) {
      onCreated(email, state.grantsRole);
      return;
    }
    if (state.redirectToSignIn) {
      const params = new URLSearchParams({ callbackUrl: "/join" });
      if (state.email) params.set("email", state.email);
      params.set("message", "Your account was created. Sign in to finish setting it up.");
      router.push(`/signin?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.redirectToSignIn]);

  return (
    <StepCard title="Your account" onBack={onBack}>
      {draft.resolvedRole && draft.accountType !== "general" ? (
        <p className="text-sm font-medium text-signal">{ROLE_COPY[draft.resolvedRole]}</p>
      ) : draft.accountType === "general" ? (
        <p className="text-sm font-medium text-signal">No code needed — this creates a general member account.</p>
      ) : null}
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="code" value={draft.code} />
        <Field label="Bison email" required error={errors.email} help="Use your Howard Bison email. This is how you'll sign in.">
          {(id) => (
            <input
              id={id}
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="yourname@bison.howard.edu"
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Password" required error={errors.password}>
          {(id) => (
            <input
              id={id}
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Confirm password" required error={errors.confirmPassword}>
          {(id) => (
            <input
              id={id}
              type="password"
              name="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.firstName}>
            {(id) => (
              <input id={id} name="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
            )}
          </Field>
          <Field label="Last name" required error={errors.lastName}>
            {(id) => (
              <input id={id} name="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            )}
          </Field>
        </div>
        <Field label="Student ID" required error={errors.studentId}>
          {(id) => (
            <input id={id} name="studentId" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputClass} />
          )}
        </Field>
        <Field label="Classification" required error={errors.classification}>
          {(id) => (
            <select
              id={id}
              name="classification"
              value={classification}
              onChange={(e) => setClassification(e.target.value as Classification)}
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
        <Field label="Major" required error={errors.major}>
          {(id) => (
            <select id={id} name="major" value={major} onChange={(e) => setMajor(e.target.value)} className={selectClass}>
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
        {major === OTHER_MAJOR ? (
          <Field label="Your major" required error={errors.majorOther}>
            {(id) => (
              <input id={id} name="majorOther" value={majorOther} onChange={(e) => setMajorOther(e.target.value)} className={inputClass} />
            )}
          </Field>
        ) : null}

        {state.error && !Object.keys(errors).length ? (
          <p role="alert" className="text-sm font-medium text-alert">
            {state.error}
          </p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </StepCard>
  );
}

/**
 * "Account" (step 3: email/password) and "About you" (step 4: name/student
 * ID/classification/major) are collected on ONE screen in AccountStep above
 * — redeemJoinCodeForSignup needs a name to create the row with, so there's
 * no useful intermediate state between them to stop at. This step is just
 * the confirmation screen, keeping the progress indicator's 8 distinct steps
 * meaningful without a second, empty round trip.
 */
function AboutYouStep({
  draft,
  onPatch,
  onBack,
  onNext,
}: {
  draft: Draft;
  onPatch: (f: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const downgraded =
    draft.accountType && draft.accountType !== "general" && draft.resolvedRole === "general";

  return (
    <StepCard title="About you" onBack={onBack}>
      <p className="text-sm text-muted">
        {draft.firstName} {draft.lastName} · {draft.studentId} · {draft.classification} · {draft.major === OTHER_MAJOR ? draft.majorOther : draft.major}
      </p>
      <p className="text-xs font-medium text-signal">
        Account created: {draft.resolvedRole ? ACCOUNT_TYPE_LABEL[draft.resolvedRole] : "General member"}
        {downgraded ? " — your code didn't grant that access level, so we created a general member account instead." : ""}
      </p>
      <p className="text-xs text-muted">Looks right? You can change these later from your account page.</p>
      <Button
        type="button"
        onClick={() => {
          onPatch({});
          onNext();
        }}
      >
        Continue
      </Button>
    </StepCard>
  );
}

/**
 * Shown when a profile-step action reports sessionExpired (see
 * requireWizardSession in join/actions.ts) — a plain retry can't fix a
 * missing session, so this offers a sign-in link instead. callbackUrl sends
 * the user straight back to /join, where the sessionStorage draft (still
 * intact — nothing here clears it) picks up at the same step.
 */
function StepError({ message, sessionExpired }: { message: string; sessionExpired?: boolean }) {
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

function ContactStep({
  draft,
  onPatch,
  onBack,
  onNext,
  isLastStep,
  onFinish,
}: {
  draft: Draft;
  onPatch: (f: Partial<Draft>) => void;
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
            {SHIRT_SIZES.map((s) => (
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

function MembershipStep({
  draft,
  membershipSiteUrl,
  nationalMembershipUrl,
  onPatch,
  onBack,
  onNext,
}: {
  draft: Draft;
  membershipSiteUrl: string;
  nationalMembershipUrl: string;
  onPatch: (f: Partial<Draft>) => void;
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

function HouseStep({
  draft,
  houses,
  houseTestUrl,
  onPatch,
  onBack,
  onNext,
}: {
  draft: Draft;
  houses: House[];
  houseTestUrl: string;
  onPatch: (f: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  // Always set by the time this step renders — the account exists and
  // AccountStep wrote the DB-confirmed role. Falls back to the role that
  // requires the most (general) rather than assuming an exemption; the
  // server re-derives from the roster either way.
  const role: Role = draft.resolvedRole ?? "general";
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
      const result = await setHouseAction(
        draft.houseSkipped ? undefined : draft.house || undefined,
        draft.houseSkipped ? undefined : draft.houseProofFileId,
      );
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

function ResumeStep({
  draft,
  onPatch,
  onBack,
  onFinish,
}: {
  draft: Draft;
  onPatch: (f: Partial<Draft>) => void;
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
