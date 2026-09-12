"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkJoinCodeAction,
  completeSignupAction,
  createAccountAction,
  type CheckJoinCodeState,
  type CreateAccountState,
} from "@/app/(public)/join/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass, selectClass } from "@/components/ui/Field";
import { CLASSIFICATION_OPTIONS, OTHER_MAJOR, coreField } from "@/lib/core-form";
import { formatClassification } from "@/lib/format";
import type { House } from "@/lib/houses";
import type { Classification, Role } from "@/lib/types";
import { stepsFor } from "./joinWizardRules";
import {
  ContactStep,
  HouseStep,
  MembershipStep,
  ProgressIndicator,
  ResumeStep,
  StepCard,
  StepError,
  type ProfileDraft,
} from "./steps";

const ACCOUNT_TYPES: Array<{ value: "general" | "eboard" | "admin"; label: string; description: string }> = [
  { value: "general", label: "General member", description: "The account most members create — announced at GBMs." },
  { value: "eboard", label: "E-Board", description: "Requires a code from a current admin." },
  { value: "admin", label: "Admin", description: "Requires a code from a current admin." },
];


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


/**
 * The shared profile fields (see steps.tsx ProfileDraft) plus the state that
 * only exists before an account does: the picker's choice, the join code, the
 * role that code resolved to, and whether the account has been created yet.
 */
interface Draft extends ProfileDraft {
  accountType: "general" | "eboard" | "admin" | null;
  code: string;
  resolvedRole: Role | null;
  email: string;
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
  const [finishError, setFinishError] = useState<string | null>(null);

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

  /**
   * Latch the signup as finished, then leave.
   *
   * Until completeSignupAction succeeds this account is mid-signup, and every
   * protected route sends it to /join/resume (see lib/signup.ts) — so this call
   * is what actually releases the member into the app, not the router.push.
   *
   * If it is refused, the wizard does NOT pretend to be done: it says so and
   * stays put. The likely cause is a step whose save failed earlier, and
   * /join/resume would re-derive the same outstanding step anyway.
   *
   * houseSkipped is forwarded because "I haven't taken the test yet" writes
   * nothing by design, so the server cannot read that answer back.
   */
  async function finish() {
    setFinishError(null);
    const result = await completeSignupAction({ houseSkipped: draft.houseSkipped });
    if (result.error || !result.destination) {
      setFinishError(result.error ?? "Something is still missing. Check the steps above.");
      return;
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
    router.push(result.destination);
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
        <HouseStep
          draft={draft}
          houses={config.houses}
          houseTestUrl={config.houseTestUrl}
          // Always set by the time this step renders — AccountStep wrote the
          // DB-confirmed role. Falls back to the role that requires the most.
          role={draft.resolvedRole ?? "general"}
          onPatch={patch}
          onBack={goBack}
          onNext={goNext}
        />
      )}

      {step === "resume" && <ResumeStep draft={draft} onPatch={patch} onBack={goBack} onFinish={finish} />}

      {finishError ? <StepError message={finishError} /> : null}
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
        <Field label="Student ID" required error={errors.studentId} help={coreField("studentId").helpText}>
          {(id) => (
            <input
              id={id}
              name="studentId"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder={coreField("studentId").placeholder}
              className={inputClass}
            />
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
        {draft.firstName} {draft.lastName} · {draft.studentId} · {formatClassification(draft.classification)} ·{" "}
        {draft.major === OTHER_MAJOR ? draft.majorOther : draft.major}
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

