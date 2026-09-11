"use client";

import Link from "next/link";
import { useState } from "react";
import CodeGate, { type CodeGateResult } from "@/components/events/CodeGate";
import CoreCheckInForm, { type CoreCheckInFormConfig, type CoreCheckInFormValue } from "@/components/forms/CoreCheckInForm";
import FormRenderer from "@/components/forms/FormRenderer";
import Button from "@/components/ui/Button";
import { getMissingFields } from "@/lib/core-form";
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
  // Nothing missing and no extra questions — skip the form entirely. Tap
  // event, tap Check in.
  const missingFields = getMissingFields(
    member,
    { audience: reduced ? "eboard_only" : "all" },
    { SEASON: coreFormConfig.currentSeason },
  );
  const skipForm = missingFields.length === 0 && extraFields.length === 0;

  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");

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
  const [extraValues, setExtraValues] = useState<FormAnswers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [result, setResult] = useState<RegisterResult | null>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      // Both core-form schemas are .strict() — extra keys are rejected wholesale
      // (as a single un-attributable root error, not a per-field one). Drop the
      // client-only display bookkeeping (houseFilename/resumeFilename — filenames
      // shown next to the upload widgets, never sent to the server otherwise)
      // before sending; the reduced form's schema additionally accepts only
      // firstName/lastName at all.
      const { houseFilename: _houseFilename, resumeFilename: _resumeFilename, ...coreToSend } = coreValue;
      const core = reduced ? { firstName: coreToSend.firstName, lastName: coreToSend.lastName } : coreToSend;
      const res = await fetch(`/api/events/${eventId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, core, extra: extraValues }),
      });
      const body = await res.json();

      if (!res.ok) {
        if (body.code === "VALIDATION_FAILED" && body.fieldErrors) {
          setFieldErrors(body.fieldErrors);
          setSubmitError("Check the highlighted fields.");
          const firstKey = Object.keys(body.fieldErrors)[0];
          document.getElementById(firstKey)?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        if (body.code === "BAD_CODE" || body.code === "EVENT_CLOSED_DURING_SUBMIT") {
          // The code rotated (or the window closed) in the time it took to
          // fill out the form — bounce back to the gate rather than showing
          // a confusing error on a form full of answers that are still fine.
          setCode("");
          setSubmitError(
            body.code === "EVENT_CLOSED_DURING_SUBMIT"
              ? "This event closed while you were filling out the form."
              : "The code changed while you were filling out the form — enter the current one to finish.",
          );
          setStep("code");
          return;
        }
        setSubmitError(body.message ?? "Something went wrong. Try again.");
        return;
      }

      setResult(body);
      setStep("receipt");
    } catch {
      setSubmitError("Couldn't reach the server. Check your connection and try again.");
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

  if (step === "code") {
    return (
      <div className="flex flex-col gap-4">
        {submitError ? (
          <p role="alert" className="text-sm font-medium text-alert">
            {submitError}
          </p>
        ) : null}
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
    if (skipForm) {
      return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-sunken px-3 py-2.5 text-sm text-ink">
            <p>
              <strong className="font-semibold">
                {member.firstName} {member.lastName}
              </strong>
            </p>
            <p className="text-xs text-muted">{email}</p>
          </div>
          {submitError ? (
            <p role="alert" className="text-sm font-medium text-alert">
              {submitError}
            </p>
          ) : null}
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
          reduced={reduced}
        />
        {extraFields.length > 0 ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">A few more questions</h2>
            <FormRenderer fields={extraFields} values={extraValues} onChange={handleExtraChange} errors={fieldErrors} />
          </section>
        ) : null}
        {submitError ? (
          <p role="alert" className="text-sm font-medium text-alert">
            {submitError}
          </p>
        ) : null}
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
            <p className="text-sm font-semibold uppercase tracking-wide text-signal">Checked in</p>
            <p className="numeric text-5xl font-semibold text-ink">
              +{result.eboardPointsAwarded} <span className="text-lg font-semibold text-muted">· E-Board</span>
            </p>
          </>
        ) : (
          // countsForEboard: false on this specific event — never a bare "+0", which reads as a bug.
          <>
            <p className="text-sm font-semibold uppercase tracking-wide text-signal">Attendance recorded · E-Board</p>
            <p className="max-w-xs text-sm text-muted">This event doesn&apos;t count toward the internal E-Board track.</p>
          </>
        )
      ) : result?.eligible ? (
        <>
          <p className="text-sm font-semibold uppercase tracking-wide text-signal">Checked in</p>
          <p className="numeric text-5xl font-semibold text-ink">+{result?.pointsAwarded}</p>
          <p className="text-sm text-muted">
            {result?.total} points total{result?.rank ? ` · rank #${result.rank}` : ""}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold uppercase tracking-wide text-signal">Attendance recorded</p>
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
      <Link href={`/leaderboard`} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
        See the leaderboard
      </Link>
    </div>
  );
}
