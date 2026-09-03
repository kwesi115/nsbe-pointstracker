"use client";

import { useActionState, useEffect } from "react";
import { updateSettingsAction, type SettingsState } from "@/app/(member)/admin/settings/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass, textareaClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

const INITIAL_STATE: SettingsState = { error: null };

export default function SettingsForm({
  chapterName,
  season,
  domain,
  adminEmailAllowlist,
  defaultEventDuration,
  leaderboardDisclaimer,
}: {
  chapterName: string;
  season: string;
  domain: string;
  adminEmailAllowlist: string;
  defaultEventDuration: string;
  leaderboardDisclaimer: string;
}) {
  const [state, formAction, pending] = useActionState(updateSettingsAction, INITIAL_STATE);
  const { show } = useToast();

  useEffect(() => {
    if (state !== INITIAL_STATE && state.error === null) show("Settings saved");
  }, [state, show]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="Chapter name">
        {(id) => <input id={id} name="chapterName" defaultValue={chapterName} className={inputClass} />}
      </Field>

      <Field
        label="Season"
        help="Changing this immediately re-arms the dues/national questions for every member and drops anyone whose reported season no longer matches off the leaderboard — no other action needed."
      >
        {(id) => <input id={id} name="season" defaultValue={season} className={inputClass} />}
      </Field>

      <Field label="Allowed email domain" help="Signup rejects any email that doesn't end with this, checked server-side.">
        {(id) => <input id={id} name="domain" defaultValue={domain} placeholder="bison.howard.edu" className={inputClass} />}
      </Field>

      <Field
        label="Admin email allowlist"
        help="One per line. These addresses can sign in even though they don't match the domain above — this does NOT open a signup path at /join, it only affects login. This is an authentication bypass list: every change here is written to the admin log."
      >
        {(id) => (
          <textarea
            id={id}
            name="adminEmailAllowlist"
            defaultValue={adminEmailAllowlist.split("|").join("\n")}
            className={textareaClass}
          />
        )}
      </Field>

      <Field
        label="Default event duration (minutes)"
        help="How long a newly created event stays open by default — the check-in code rotates for as long as this window is open. Open now/reopen can still pick a different duration per event."
      >
        {(id) => (
          <input id={id} name="defaultEventDuration" type="number" min={1} defaultValue={defaultEventDuration} className={inputClass} />
        )}
      </Field>

      <Field label="Leaderboard disclaimer" help="Shown on /leaderboard below the header, and as a header note on the leaderboard CSV/Excel exports.">
        {(id) => (
          <textarea id={id} name="leaderboardDisclaimer" defaultValue={leaderboardDisclaimer} className={textareaClass} />
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
