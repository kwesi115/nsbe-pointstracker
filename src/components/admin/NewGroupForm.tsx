"use client";

import { useActionState, useState } from "react";
import { createGroupAction, type GroupActionState } from "@/app/(member)/admin/groups/actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass, textareaClass } from "@/components/ui/Field";

const INITIAL_STATE: GroupActionState = { error: null };
const DEFAULT_TIERS = JSON.stringify(
  [
    { min: 3, max: 4, bonus: 3 },
    { min: 5, max: null, bonus: 5 },
  ],
  null,
  2,
);

export default function NewGroupForm() {
  const [state, formAction, pending] = useActionState(createGroupAction, INITIAL_STATE);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="self-start">
        New group
      </Button>
    );
  }

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Name" required>
          {(id) => <input id={id} name="name" required placeholder="NSBE Week 2027" className={inputClass} />}
        </Field>
        <Field label="Expected event count">
          {(id) => <input id={id} type="number" name="expectedEventCount" defaultValue={5} className={inputClass} />}
        </Field>
        <Field label="Bonus tiers (JSON)" help='[{"min":3,"max":4,"bonus":3},{"min":5,"max":null,"bonus":5}] — max: null means no ceiling.'>
          {(id) => <textarea id={id} name="bonusTiers" defaultValue={DEFAULT_TIERS} rows={5} className={`${textareaClass} font-mono text-xs`} />}
        </Field>
        {state.error ? <p className="text-sm font-medium text-alert">{state.error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create group"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
