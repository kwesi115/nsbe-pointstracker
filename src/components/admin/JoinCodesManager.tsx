"use client";

import { Check, Copy } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import {
  createJoinCodeAction,
  deactivateJoinCodeAction,
  rotateJoinCodeAction,
  type JoinCodeActionState,
} from "@/app/(member)/admin/join-codes/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass, selectClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import type { JoinCodeSummary, Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  eboard: "E-Board",
  general: "General",
  guest: "Guest",
};

const INITIAL_STATE: JoinCodeActionState = { error: null };

/** A code's plaintext is shown exactly once — right after create/rotate, never re-fetchable afterward (the DB only ever holds the bcrypt hash). */
function PlaintextReveal({ plaintext, onDismiss }: { plaintext: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="flex flex-col gap-3 border-signal bg-signal/5">
      <p className="text-sm font-semibold text-ink">New code — shown once, write it down now:</p>
      <div className="flex items-center gap-2">
        <code className="numeric flex-1 rounded-lg border border-line bg-white px-3 py-2 text-lg tracking-widest">
          {plaintext}
        </code>
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(plaintext);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Button type="button" variant="ghost" className="self-start" onClick={onDismiss}>
        Done
      </Button>
    </Card>
  );
}

function CreateForm({ onCreated }: { onCreated: (plaintext: string) => void }) {
  const [state, formAction, pending] = useActionState(createJoinCodeAction, INITIAL_STATE);
  if (state.plaintext) onCreated(state.plaintext);

  return (
    <Card>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <Field label="Label">
          {(id) => <input id={id} name="label" required placeholder="Fall 2026 member code" className={`${inputClass} w-56`} />}
        </Field>
        <Field label="Grants role">
          {(id) => (
            <select id={id} name="grantsRole" defaultValue="general" className={`${selectClass} w-36`}>
              <option value="general">General</option>
              <option value="eboard">E-Board</option>
              <option value="admin">Admin</option>
              <option value="guest">Guest</option>
            </select>
          )}
        </Field>
        <Field label="Max uses" help="Optional">
          {(id) => <input id={id} name="maxUses" type="number" min={1} className={`${inputClass} w-28`} />}
        </Field>
        <Field label="Expires" help="Optional">
          {(id) => <input id={id} name="expiresAt" type="date" className={`${inputClass} w-40`} />}
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create code"}
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-alert">
          {state.error}
        </p>
      ) : null}
    </Card>
  );
}

function CodeRow({ code, onRotated }: { code: JoinCodeSummary; onRotated: (plaintext: string) => void }) {
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  function rotate() {
    startTransition(async () => {
      const result = await rotateJoinCodeAction(code.id);
      if (result.error) show(result.error, "error");
      else if (result.plaintext) onRotated(result.plaintext);
    });
  }

  function deactivate() {
    startTransition(async () => {
      const result = await deactivateJoinCodeAction(code.id);
      if (result.error) show(result.error, "error");
      else show(`"${code.label}" deactivated`);
    });
  }

  return (
    <tr className="border-b border-line last:border-0">
      <td className={tdClass}>{code.label}</td>
      <td className={tdClass}>
        <Badge tone={code.grantsRole === "admin" ? "alert" : code.grantsRole === "eboard" ? "amber" : "muted"}>
          {ROLE_LABEL[code.grantsRole]}
        </Badge>
      </td>
      <td className={`${tdClass} numeric`}>{code.codeHint}</td>
      <td className={`${tdClass} numeric`}>
        {code.useCount}
        {code.maxUses !== null ? ` / ${code.maxUses}` : ""}
      </td>
      <td className={tdClass}>{code.expiresAt ? formatDateTime(code.expiresAt) : "Never"}</td>
      <td className={tdClass}>{code.active ? <Badge tone="signal">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
      <td className={tdClass}>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={rotate} disabled={isPending}>
            Rotate
          </Button>
          {code.active ? (
            <Button type="button" variant="danger" onClick={deactivate} disabled={isPending}>
              Deactivate
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export default function JoinCodesManager({ codes }: { codes: JoinCodeSummary[] }) {
  const [reveal, setReveal] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {reveal ? <PlaintextReveal plaintext={reveal} onDismiss={() => setReveal(null)} /> : null}

      <CreateForm onCreated={setReveal} />

      {codes.length === 0 ? (
        <p className="text-sm text-muted">No join codes yet.</p>
      ) : (
        <Table>
          <Thead>
            <th className={thClass}>Label</th>
            <th className={thClass}>Role</th>
            <th className={thClass}>Hint</th>
            <th className={thClass}>Uses</th>
            <th className={thClass}>Expires</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Actions</th>
          </Thead>
          <tbody>
            {codes.map((code) => (
              <CodeRow key={code.id} code={code} onRotated={setReveal} />
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
