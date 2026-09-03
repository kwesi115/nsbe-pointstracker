"use client";

import { useState, useTransition } from "react";
import { adminUpdateProfileAction } from "@/app/(member)/admin/members/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass, selectClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { CLASSIFICATION_OPTIONS, OTHER_MAJOR } from "@/lib/core-form";
import type { Classification, Member } from "@/lib/types";

type ProfileMember = Pick<Member, "email" | "firstName" | "lastName" | "studentId" | "classification" | "major" | "majorOther">;

/** Every field, admin-editable — each edit logged via adminUpdateProfileAction (same updateProfileFields mutator /account uses, actor is the admin). */
export default function AdminProfilePanel({ member, majors }: { member: ProfileMember; majors: string[] }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(member.firstName);
  const [lastName, setLastName] = useState(member.lastName);
  const [studentId, setStudentId] = useState(member.studentId);
  const [classification, setClassification] = useState<Classification | "">(member.classification);
  const [major, setMajor] = useState(member.major);
  const [majorOther, setMajorOther] = useState(member.majorOther);
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  function save() {
    startTransition(async () => {
      const result = await adminUpdateProfileAction(member.email, {
        firstName,
        lastName,
        studentId,
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
    setClassification(member.classification);
    setMajor(member.major);
    setMajorOther(member.majorOther);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        <Table>
          <Thead>
            <th className={thClass}>Field</th>
            <th className={thClass}>Value</th>
          </Thead>
          <tbody>
            <tr className="border-b border-line">
              <td className={tdClass}>Name</td>
              <td className={tdClass}>
                {member.firstName} {member.lastName}
              </td>
            </tr>
            <tr className="border-b border-line">
              <td className={tdClass}>Student ID</td>
              <td className={tdClass}>{member.studentId || "—"}</td>
            </tr>
            <tr className="border-b border-line">
              <td className={tdClass}>Classification</td>
              <td className={tdClass}>{CLASSIFICATION_OPTIONS.find((o) => o.value === member.classification)?.label ?? "—"}</td>
            </tr>
            <tr className="last:border-0">
              <td className={tdClass}>Major</td>
              <td className={tdClass}>{(member.major === "Other" ? member.majorOther : member.major) || "—"}</td>
            </tr>
          </tbody>
        </Table>
        <Button type="button" variant="secondary" onClick={() => setEditing(true)} className="self-start">
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="First name">{(id) => <input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />}</Field>
        <Field label="Last name">{(id) => <input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />}</Field>
      </div>
      <Field label="Student ID">{(id) => <input id={id} value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputClass} />}</Field>
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
        <Field label="Their major">{(id) => <input id={id} value={majorOther} onChange={(e) => setMajorOther(e.target.value)} className={inputClass} />}</Field>
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
  );
}
