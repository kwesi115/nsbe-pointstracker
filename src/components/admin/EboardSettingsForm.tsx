"use client";

import { useActionState, useEffect } from "react";
import { updateEboardSettingsAction } from "@/app/(member)/admin/settings/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

interface SettingsState {
  error: string | null;
}

const INITIAL_STATE: SettingsState = { error: null };

export default function EboardSettingsForm({
  eboardPointValue,
  eboardTrackEnabled,
  eboardRequiresMembership,
}: {
  eboardPointValue: string;
  eboardTrackEnabled: boolean;
  eboardRequiresMembership: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateEboardSettingsAction, INITIAL_STATE);
  const { show } = useToast();

  useEffect(() => {
    if (state !== INITIAL_STATE && state.error === null) show("Settings saved");
  }, [state, show]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="Points per qualifying event" help="Flat amount an E-Board member earns on the internal track — never a deploy to change.">
        {(id) => (
          <input id={id} name="eboardPointValue" type="number" min={0} defaultValue={eboardPointValue} className={inputClass} />
        )}
      </Field>

      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="eboardTrackEnabled" defaultChecked={eboardTrackEnabled} className="h-4 w-4" />
        Internal E-Board track enabled
      </label>

      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="eboardRequiresMembership" defaultChecked={eboardRequiresMembership} className="h-4 w-4" />
        Require dues/national verification for internal points too
      </label>
      <p className="text-xs text-muted">
        Off by default — officers doing chapter work shouldn&apos;t have their internal accountability metric gated
        on a dues receipt.
      </p>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
