"use client";

import { useActionState, useEffect, useState } from "react";
import { updateCoreFormSettingsAction } from "@/app/(member)/admin/settings/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass, textareaClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import type { House } from "@/lib/houses";

interface SettingsState {
  error: string | null;
}

const INITIAL_STATE: SettingsState = { error: null };

export default function CoreFormSettingsForm({
  majorsList,
  houses: initialHouses,
  showPendingPoints,
  maxExtraQuestions,
}: {
  majorsList: string;
  houses: House[];
  showPendingPoints: boolean;
  maxExtraQuestions: string;
}) {
  const [state, formAction, pending] = useActionState(updateCoreFormSettingsAction, INITIAL_STATE);
  const { show } = useToast();
  // Structured (name + color), not a one-per-line textarea — the color is
  // part of a House's identity now (see lib/houses.ts). Serialized into a
  // hidden field on submit; the server always regenerates `code` from name.
  const [houses, setHouses] = useState<House[]>(initialHouses);

  useEffect(() => {
    if (state !== INITIAL_STATE && state.error === null) show("Settings saved");
  }, [state, show]);

  function updateHouse(i: number, patch: Partial<House>) {
    setHouses((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }
  function addHouse() {
    setHouses((prev) => [...prev, { code: "", name: "", color: "#5A6485" }]);
  }
  function removeHouse(i: number) {
    setHouses((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="Majors" help="One per line — shown in the check-in form's Major dropdown, plus a fixed &quot;Other&quot; option.">
        {(id) => (
          <textarea id={id} name="majorsList" defaultValue={majorsList.split("|").join("\n")} className={textareaClass} />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">NSBE Houses</p>
        <p className="text-xs text-muted">
          Name and color for each House — the color renders as a dot beside the name everywhere a House appears.
        </p>
        <div className="flex flex-col gap-2">
          {houses.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                value={h.color}
                onChange={(e) => updateHouse(i, { color: e.target.value })}
                className="h-9 w-9 shrink-0 rounded border border-line"
                aria-label={`Color for ${h.name || "this House"}`}
              />
              <input
                value={h.name}
                onChange={(e) => updateHouse(i, { name: e.target.value })}
                placeholder="House name"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => removeHouse(i)}
                className="shrink-0 text-xs font-semibold text-alert"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" onClick={addHouse} className="self-start">
          Add House
        </Button>
        <input type="hidden" name="housesJson" value={JSON.stringify(houses)} />
      </div>

      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="showPendingPoints" defaultChecked={showPendingPoints} className="h-4 w-4" />
        Show a member&apos;s pending point total while ineligible
      </label>

      <Field label="Max extra questions per event" help="Hard ceiling is 5 regardless of this value.">
        {(id) => (
          <input id={id} name="maxExtraQuestions" type="number" min={0} max={5} defaultValue={maxExtraQuestions} className={inputClass} />
        )}
      </Field>

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
