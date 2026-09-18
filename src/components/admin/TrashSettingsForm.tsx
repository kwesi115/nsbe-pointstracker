"use client";

import { useActionState, useEffect } from "react";
import { updateTrashRetentionAction, type SettingsState } from "@/app/(member)/admin/settings/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

const INITIAL_STATE: SettingsState = { error: null };

/** Config.TRASH_RETENTION_DAYS. Saving recomputes the deletion date of everything already in the trash, not just what's trashed from now on. */
export default function TrashSettingsForm({ retentionDays, maxDays }: { retentionDays: number; maxDays: number }) {
  const [state, formAction, pending] = useActionState(updateTrashRetentionAction, INITIAL_STATE);
  const { show } = useToast();

  useEffect(() => {
    if (state !== INITIAL_STATE && state.error === null) show("Retention saved");
  }, [state, show]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field
        label="Keep deleted items for (days)"
        help="Deleted accounts and events stay in the trash this long, then are permanently deleted. Changing this re-dates everything already in the trash — shortening it can make items due right away."
        error={state.error}
      >
        {(id, describedBy) => (
          <input
            id={id}
            name="trashRetentionDays"
            type="number"
            min={1}
            max={maxDays}
            step={1}
            defaultValue={retentionDays}
            aria-describedby={describedBy}
            className={inputClass}
          />
        )}
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save retention"}
      </Button>
    </form>
  );
}
