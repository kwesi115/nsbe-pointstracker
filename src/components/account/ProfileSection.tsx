"use client";

import { useState, useTransition } from "react";
import { updateProfileAction } from "@/app/(member)/account/actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass, selectClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { CLASSIFICATION_OPTIONS, OTHER_MAJOR, coreField } from "@/lib/core-form";
import type { Classification, Member } from "@/lib/types";

type ProfileMember = Pick<
  Member,
  "firstName" | "lastName" | "studentId" | "phone" | "personalEmail" | "classification" | "major" | "majorOther"
>;

/** Profile — name, student ID, contact info, classification, major. Inline edit, saves as its own section (Part 4). Phone and personal email are required (Part 2) — save is blocked client-side, and rejected server-side, when either is blank. */
export default function ProfileSection({ member, majors }: { member: ProfileMember; majors: string[] }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(member.firstName);
  const [lastName, setLastName] = useState(member.lastName);
  const [studentId, setStudentId] = useState(member.studentId);
  const [phone, setPhone] = useState(member.phone);
  const [personalEmail, setPersonalEmail] = useState(member.personalEmail);
  const [classification, setClassification] = useState<Classification | "">(member.classification);
  const [major, setMajor] = useState(member.major);
  const [majorOther, setMajorOther] = useState(member.majorOther);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  function save() {
    setError(null);
    if (!phone.trim() || !personalEmail.trim()) {
      setError("Phone and personal email are required.");
      return;
    }
    startTransition(async () => {
      const result = await updateProfileAction({
        firstName,
        lastName,
        studentId,
        phone,
        personalEmail,
        ...(classification ? { classification } : {}),
        major,
        majorOther: major === OTHER_MAJOR ? majorOther : "",
      });
      if (result.error) {
        show(result.error, "error");
      } else {
        show("Profile updated");
        setEditing(false);
      }
    });
  }

  function cancel() {
    setFirstName(member.firstName);
    setLastName(member.lastName);
    setStudentId(member.studentId);
    setPhone(member.phone);
    setPersonalEmail(member.personalEmail);
    setClassification(member.classification);
    setMajor(member.major);
    setMajorOther(member.majorOther);
    setError(null);
    setEditing(false);
  }

  return (
    <section id="profile" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Profile</h2>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-signal underline underline-offset-2"
          >
            Edit
          </button>
        ) : null}
      </div>
      <Card>
        {!editing ? (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Name</dt>
              <dd className="text-ink">
                {member.firstName} {member.lastName}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Student ID</dt>
              <dd className="text-ink">{member.studentId || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Phone</dt>
              <dd className="text-ink">{member.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Personal email</dt>
              <dd className="text-ink">{member.personalEmail || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Classification</dt>
              <dd className="text-ink">{CLASSIFICATION_OPTIONS.find((o) => o.value === member.classification)?.label ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Major</dt>
              <dd className="text-ink">{(member.major === "" ? "" : member.major === "Other" ? member.majorOther : member.major) || "—"}</dd>
            </div>
          </dl>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name">{(id) => <input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />}</Field>
              <Field label="Last name">{(id) => <input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />}</Field>
            </div>
            <Field label="Student ID">{(id) => <input id={id} value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputClass} />}</Field>
            <Field label="Phone" required>
              {(id) => <input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />}
            </Field>
            <Field label="Personal email" required help={coreField("personalEmail").helpText}>
              {(id) => (
                <input
                  id={id}
                  type="email"
                  value={personalEmail}
                  onChange={(e) => setPersonalEmail(e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Classification">
              {(id) => (
                <select id={id} value={classification} onChange={(e) => setClassification(e.target.value as Classification)} className={selectClass}>
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
            <Field label="Major">
              {(id) => (
                <select id={id} value={major} onChange={(e) => setMajor(e.target.value)} className={selectClass}>
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
              <Field label="Your major">{(id) => <input id={id} value={majorOther} onChange={(e) => setMajorOther(e.target.value)} className={inputClass} />}</Field>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm font-medium text-alert">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={cancel} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
