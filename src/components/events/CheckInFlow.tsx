"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CodeGate, { type CodeGateResult } from "@/components/events/CodeGate";
import CoreCheckInForm, { type CoreCheckInFormConfig, type CoreCheckInFormValue } from "@/components/forms/CoreCheckInForm";
import FormRenderer from "@/components/forms/FormRenderer";
import { revealField } from "@/components/forms/revealField";
import Button from "@/components/ui/Button";
import {
  PAYLOAD_KEYS_BY_FIELD,
  askableFields,
  coreField,
  fieldForPayloadKey,
  getMissingFields,
  liveFields,
  type CoreFieldKey,
  type RenderedFieldKey,
} from "@/lib/core-form";
import { displayTotal } from "@/lib/points";
import type { AnswerValue, FormAnswers } from "@/lib/forms";
import type { FormField, Member } from "@/lib/types";

type Step = "code" | "form" | "receipt";

interface RegisterResult {
  pointsAwarded: number;
  total: number;
  rank: number | null;
  eligible: boolean;
  /** Non-null whenever the registrant is currently EBOARD — see repo.ts registerForEvent. */
  eboardPointsAwarded: number | null;
}

/** What a rejected submission tells the member — always by name, never just "the highlighted fields". */
interface SubmitProblem {
  message: string;
  /** Something the form can't show on this screen — the fix is on /account, so link there. */
  needsAccount: boolean;
}

/** A field's name as the member reads it, for the error banner. */
function fieldLabel(field: RenderedFieldKey): string {
  if (field === "resume") return "Resume";
  return coreField(field).label;
}

function listOf(labels: string[]): string {
  const unique = [...new Set(labels)];
  if (unique.length <= 1) return unique.join("");
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

export default function CheckInFlow({
  eventId,
  extraFields,
  member,
  email,
  coreFormConfig,
  reduced = false,
}: {
  eventId: string;
  extraFields: FormField[];
  member: Pick<
    Member,
    | "role"
    | "firstName"
    | "lastName"
    | "studentId"
    | "phone"
    | "personalEmail"
    | "tshirtSize"
    | "classification"
    | "major"
    | "majorOther"
    | "profileSeason"
    | "nsbeMembershipId"
    | "house"
    | "houseVerifiedAt"
    | "resumeFileId"
    | "duesPaidReported"
    | "nationalMemberReported"
    | "membershipSeason"
  >;
  email: string;
  coreFormConfig: CoreCheckInFormConfig;
  /** EBOARD_ONLY events use the reduced core form (Part 6) — firstName/lastName/bisonEmail only. */
  reduced?: boolean;
}) {
  const event = { audience: reduced ? "eboard_only" : "all" } as const;
  const config = { SEASON: coreFormConfig.currentSeason };

  // Nothing missing and no extra questions — skip the form entirely. Tap
  // event, tap Check in.
  const missingFields = getMissingFields(member, event, config);
  const skipForm = missingFields.length === 0 && extraFields.length === 0;

  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");

  // Seeds the inputs with what's on file, so an Edit starts from the current
  // value. Seeding is NOT submitting: only fields that are live go in the
  // payload (see handleSubmit) — an unrendered seed used to be sent too, and a
  // stored value the schema disliked failed a check-in on a field nobody saw.
  const [coreValue, setCoreValue] = useState<CoreCheckInFormValue>({
    firstName: member.firstName,
    lastName: member.lastName,
    studentId: member.studentId,
    phone: member.phone || undefined,
    personalEmail: member.personalEmail || undefined,
    classification: member.classification || undefined,
    major: member.major || undefined,
    majorOther: member.majorOther || undefined,
    nsbeMembershipId: member.nsbeMembershipId || undefined,
  });
  // Receipt rows the member pressed Edit on — or that a rejected submission
  // opened, so the field the server named is on screen to fix.
  const [editing, setEditing] = useState<ReadonlySet<CoreFieldKey>>(new Set());
  // The one-tap screen has no inputs to highlight; a rejection there opens the form.
  const [forceForm, setForceForm] = useState(false);
  const [extraValues, setExtraValues] = useState<FormAnswers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<SubmitProblem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A selector for the first errored field, scrolled to once it has rendered.
  const [scrollTarget, setScrollTarget] = useState<{ selector: string } | null>(null);

  const [result, setResult] = useState<RegisterResult | null>(null);

  const showForm = !skipForm || forceForm;
  // Exactly what CoreCheckInForm renders — the same liveFields call — so the
  // payload and the `rendered` report can't drift from the screen.
  const live = liveFields({ user: member, event, config, editing, majorValue: coreValue.major });
  const shown: ReadonlySet<RenderedFieldKey> = showForm ? live : new Set();

  useEffect(() => {
    if (!scrollTarget) return;
    const el = document.querySelector<HTMLElement>(scrollTarget.selector);
    if (el) revealField(el);
  }, [scrollTarget]);

  function edit(...keys: CoreFieldKey[]) {
    setEditing((prev) => new Set([...prev, ...keys]));
  }

  function handleCoreChange(patch: CoreCheckInFormValue) {
    setCoreValue((prev) => ({ ...prev, ...patch }));
    setFieldErrors((prev) => {
      const changedKeys = Object.keys(patch);
      if (!changedKeys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of changedKeys) delete next[k];
      return next;
    });
  }

  function handleExtraChange(key: string, value: AnswerValue) {
    setExtraValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /**
   * Turns a 422's fieldErrors into something the member can act on. A field
   * this form can show is opened (if it was a receipt row), highlighted and
   * scrolled to. A field it can't show on this screen — which the server
   * shouldn't ever name any more (lib/core-form.ts planCheckIn), but an older
   * deploy or a new bug could — is named in words with a link to /account,
   * instead of "Check the highlighted fields." over nothing highlighted.
   */
  function presentFieldErrors(errors: Record<string, string>, serverMessage: string) {
    const askable = askableFields(member.role, event);
    const toOpen: CoreFieldKey[] = [];
    const shownLabels: string[] = [];
    const accountLabels: string[] = [];
    let firstSelector: string | null = null;

    for (const key of Object.keys(errors)) {
      const extra = extraFields.find((f) => f.fieldKey === key);
      if (extra) {
        shownLabels.push(extra.label || extra.fieldKey);
        firstSelector ??= `[data-extra-field="${CSS.escape(key)}"]`;
        continue;
      }
      const field = fieldForPayloadKey(key);
      if (field && askable.has(field)) {
        if (field !== "nsbeMembershipId" && !live.has(field)) toOpen.push(field);
        if (field === "firstName" || field === "lastName") toOpen.push("firstName", "lastName");
        shownLabels.push(fieldLabel(field));
        firstSelector ??= `[data-core-field="${field}"]`;
        continue;
      }
      accountLabels.push(field ? fieldLabel(field) : key);
    }

    if (toOpen.length > 0) edit(...toOpen);
    if (shownLabels.length > 0) setForceForm(true);
    setFieldErrors(errors);
    if (firstSelector) setScrollTarget({ selector: firstSelector });

    if (accountLabels.length > 0) {
      const named = accountLabels.filter((l) => l !== "_form");
      setSubmitError({
        message:
          named.length > 0
            ? `We couldn't check you in: ${listOf(named)} on your profile needs attention.`
            : `We couldn't check you in: ${serverMessage}`,
        needsAccount: true,
      });
    } else {
      setSubmitError({ message: `Fix the highlighted ${shownLabels.length === 1 ? "field" : "fields"}: ${listOf(shownLabels)}.`, needsAccount: false });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      // Only what's on screen. houseFilename/resumeFilename are display-only
      // and never listed in PAYLOAD_KEYS_BY_FIELD, so they can't ride along.
      const core: Record<string, unknown> = {};
      for (const field of shown) {
        for (const key of PAYLOAD_KEYS_BY_FIELD[field]) {
          if (coreValue[key] !== undefined) core[key] = coreValue[key];
        }
      }
      const res = await fetch(`/api/events/${eventId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, core, rendered: [...shown], extra: extraValues }),
      });
      const body = await res.json();

      if (!res.ok) {
        if (body.code === "VALIDATION_FAILED" && body.fieldErrors && Object.keys(body.fieldErrors).length > 0) {
          presentFieldErrors(body.fieldErrors, body.message ?? "");
          return;
        }
        if (body.code === "BAD_CODE" || body.code === "EVENT_CLOSED_DURING_SUBMIT") {
          // The code rotated (or the window closed) in the time it took to
          // fill out the form — bounce back to the gate rather than showing
          // a confusing error on a form full of answers that are still fine.
          setCode("");
          setSubmitError({
            message:
              body.code === "EVENT_CLOSED_DURING_SUBMIT"
                ? "This event closed while you were filling out the form."
                : "The code changed while you were filling out the form — enter the current one to finish.",
            needsAccount: false,
          });
          setStep("code");
          return;
        }
        setSubmitError({ message: body.message ?? "Something went wrong. Try again.", needsAccount: false });
        return;
      }

      setResult(body);
      setStep("receipt");
    } catch {
      setSubmitError({ message: "Couldn't reach the server. Check your connection and try again.", needsAccount: false });
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(submitted: string): Promise<CodeGateResult> {
    const res = await fetch(`/api/events/${eventId}/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: submitted }),
    });
    const body = await res.json();
    if (res.ok) return { ok: true, error: null };
    return { ok: false, error: body.message ?? "That code isn't right.", eventNotOpen: body.code === "EVENT_NOT_OPEN" };
  }

  const errorBanner = submitError ? (
    <p role="alert" className="text-sm font-medium text-alert">
      {submitError.message}
      {submitError.needsAccount ? (
        <>
          {" "}
          {/* A new tab: this one holds the code and the countdown. */}
          <Link href="/account" target="_blank" rel="noopener" className="underline underline-offset-2">
            Update it on your account
          </Link>
          , then press Check in again.
        </>
      ) : null}
    </p>
  ) : null;

  if (step === "code") {
    return (
      <div className="flex flex-col gap-4">
        {errorBanner}
        <CodeGate
          onVerify={verifyCode}
          onVerified={(verified) => {
            setCode(verified);
            setSubmitError(null);
            setStep("form");
          }}
        />
      </div>
    );
  }

  if (step === "form") {
    // Nothing missing, no extra questions — no gap to fill. Confirm identity
    // and check in with one tap, rather than re-rendering an empty form.
    if (!showForm) {
      return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-raised px-3 py-2.5 text-sm text-foreground">
            <p>
              <strong className="font-semibold">
                {member.firstName} {member.lastName}
              </strong>
            </p>
            <p className="text-xs text-muted">{email}</p>
          </div>
          {errorBanner}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Checking in…" : "Check in"}
          </Button>
        </form>
      );
    }

    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        <CoreCheckInForm
          member={member}
          email={email}
          config={coreFormConfig}
          value={coreValue}
          onChange={handleCoreChange}
          errors={fieldErrors}
          editing={editing}
          onEdit={edit}
          reduced={reduced}
        />
        {extraFields.length > 0 ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">A few more questions</h2>
            <FormRenderer fields={extraFields} values={extraValues} onChange={handleExtraChange} errors={fieldErrors} />
          </section>
        ) : null}
        {errorBanner}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Check in"}
        </Button>
      </form>
    );
  }

  return (
    <div className="motion-safe:animate-[fadeIn_0.3s_ease-out] flex flex-col items-center gap-3 py-8 text-center">
      {result?.eboardPointsAwarded !== null && result?.eboardPointsAwarded !== undefined ? (
        result.eboardPointsAwarded > 0 ? (
          <>
            <p className="text-sm font-semibold uppercase tracking-wide text-signal-strong">Checked in</p>
            <p className="numeric text-5xl font-semibold text-foreground">
              +{result.eboardPointsAwarded} <span className="text-lg font-semibold text-muted">· E-Board</span>
            </p>
          </>
        ) : (
          // countsForEboard: false on this specific event — never a bare "+0", which reads as a bug.
          <>
            <p className="text-sm font-semibold uppercase tracking-wide text-signal-strong">Attendance recorded · E-Board</p>
            <p className="max-w-xs text-sm text-muted">This event doesn&apos;t count toward the internal E-Board track.</p>
          </>
        )
      ) : result?.eligible ? (
        <>
          <p className="text-sm font-semibold uppercase tracking-wide text-signal-strong">Checked in</p>
          <p className="numeric text-5xl font-semibold text-foreground">+{result?.pointsAwarded}</p>
          <p className="text-sm text-muted">
            {displayTotal(result?.total ?? 0)} points total{result?.rank ? ` · rank #${result.rank}` : ""}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold uppercase tracking-wide text-signal-strong">Attendance recorded</p>
          <p className="max-w-xs text-sm text-muted">
            Your points will count toward the leaderboard once your chapter dues and National NSBE membership are
            confirmed. See your dashboard for what&apos;s outstanding.
          </p>
        </>
      )}
      <div className="mt-3 flex gap-2">
        <Button href="/dashboard" variant="secondary">
          View dashboard
        </Button>
        <Button href="/events">More events</Button>
      </div>
      <Link href={`/leaderboard`} className="text-sm text-muted underline underline-offset-2 hover:text-foreground">
        See the leaderboard
      </Link>
    </div>
  );
}
