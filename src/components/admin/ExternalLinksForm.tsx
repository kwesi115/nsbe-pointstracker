"use client";

import { useActionState, useEffect } from "react";
import { updateExternalLinksAction } from "@/app/(member)/admin/settings/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

interface SettingsState {
  error: string | null;
}

const INITIAL_STATE: SettingsState = { error: null };

/** The three outbound links the core form references — grouped together (Part 2) so an admin can see and update them in one place, rather than hunting across the Check-in form and Membership sections. */
export default function ExternalLinksForm({
  houseTestUrl,
  membershipSiteUrl,
  nationalMembershipUrl,
}: {
  houseTestUrl: string;
  membershipSiteUrl: string;
  nationalMembershipUrl: string;
}) {
  const [state, formAction, pending] = useActionState(updateExternalLinksAction, INITIAL_STATE);
  const { show } = useToast();

  useEffect(() => {
    if (state !== INITIAL_STATE && state.error === null) show("Settings saved");
  }, [state, show]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="House test URL" help="The prominent link at the top of the House step, before the dropdown and upload.">
        {(id) => <input id={id} name="houseTestUrl" defaultValue={houseTestUrl} className={inputClass} />}
      </Field>

      <Field label="Chapter dues URL" help="Linked from the &quot;Have you paid your chapter dues?&quot; question when a member hasn't paid.">
        {(id) => <input id={id} name="membershipSiteUrl" defaultValue={membershipSiteUrl} className={inputClass} />}
      </Field>

      <Field label="National membership URL" help="Linked from the &quot;Are you a National NSBE member?&quot; question for anyone who isn't a member yet.">
        {(id) => <input id={id} name="nationalMembershipUrl" defaultValue={nationalMembershipUrl} className={inputClass} />}
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
