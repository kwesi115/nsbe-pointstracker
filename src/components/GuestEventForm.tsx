"use client";

import { CheckCircle2 } from "lucide-react";
import { useState, useTransition } from "react";
import { submitGuestRegistrationAction, verifyGuestEventCodeAction } from "@/app/(guest)/guest/events/[id]/actions";
import CodeGate, { type CodeGateResult } from "@/components/events/CodeGate";
import FormRenderer from "@/components/forms/FormRenderer";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Field, { inputClass } from "@/components/ui/Field";
import type { AnswerValue, FormAnswers } from "@/lib/forms";
import type { FormField as FormFieldType } from "@/lib/types";

export default function GuestEventForm({
  eventId,
  extraFields,
}: {
  eventId: string;
  extraFields: FormFieldType[];
}) {
  // The code is what proves presence for a guest — no account means no other
  // gate at all — so it comes before the form, same as the member flow.
  const [codeVerified, setCodeVerified] = useState(false);
  const [code, setCode] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [phone, setPhone] = useState("");
  const [extra, setExtra] = useState<FormAnswers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function setExtraValue(key: string, value: AnswerValue) {
    setExtra((prev) => ({ ...prev, [key]: value }));
  }

  async function verifyEventCode(submitted: string): Promise<CodeGateResult> {
    const result = await verifyGuestEventCodeAction(eventId, submitted);
    return { ok: result.ok, error: result.error, eventNotOpen: result.eventNotOpen };
  }

  function submit() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await submitGuestRegistrationAction({
        eventId,
        code,
        firstName,
        lastName,
        email,
        affiliation,
        phone,
        extra,
      });
      if (result.success) {
        setSuccess(true);
      } else if (result.errorCode === "BAD_CODE" || result.errorCode === "EVENT_CLOSED_DURING_SUBMIT") {
        // The code rotated (or the window closed) while the form was being
        // filled out — back to the gate rather than a confusing error on an
        // otherwise-fine form.
        setCodeVerified(false);
        setCode("");
        setError(
          result.errorCode === "EVENT_CLOSED_DURING_SUBMIT"
            ? "This event closed while you were filling out the form."
            : "The code changed while you were filling out the form — enter the current one to finish.",
        );
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  if (success) {
    return <EmptyState icon={CheckCircle2} title="You're checked in" description="Thanks for coming out." />;
  }

  if (!codeVerified) {
    return (
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-sm font-medium text-alert">
            {error}
          </p>
        ) : null}
        <CodeGate
          onVerify={verifyEventCode}
          onVerified={(verified) => {
            setCode(verified);
            setError(null);
            setCodeVerified(true);
          }}
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-5"
    >
      <Field label="First name" required error={fieldErrors.firstName}>
        {(id, describedBy) => (
          <input
            id={id}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            aria-describedby={describedBy}
            className={inputClass}
          />
        )}
      </Field>

      <Field label="Last name" required error={fieldErrors.lastName}>
        {(id, describedBy) => (
          <input
            id={id}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            aria-describedby={describedBy}
            className={inputClass}
          />
        )}
      </Field>

      <Field label="Email" required error={fieldErrors.email}>
        {(id, describedBy) => (
          <input
            id={id}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-describedby={describedBy}
            className={inputClass}
          />
        )}
      </Field>

      <Field label="School / affiliation">
        {(id) => (
          <input id={id} value={affiliation} onChange={(e) => setAffiliation(e.target.value)} className={inputClass} />
        )}
      </Field>

      <Field label="Phone" help="Optional">
        {(id) => <input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />}
      </Field>

      {extraFields.length > 0 ? (
        <FormRenderer fields={extraFields} values={extra} onChange={setExtraValue} errors={fieldErrors} />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking in…" : "Check in"}
      </Button>
    </form>
  );
}
