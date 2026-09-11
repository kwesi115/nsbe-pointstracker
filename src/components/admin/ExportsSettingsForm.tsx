"use client";

import { useActionState, useEffect } from "react";
import { updateExportsSettingsAction } from "@/app/(member)/admin/settings/actions";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface SettingsState {
  error: string | null;
}

const INITIAL_STATE: SettingsState = { error: null };

/**
 * The org-wide exports switch (Config.EXPORTS_ENABLED). Off means /admin/exports,
 * every /api/admin/export/* endpoint, and every "Export CSV" affordance across
 * the admin pages all disappear together — one flag, one place to flip it, no
 * deploy. The export code and its tests are untouched either way; this only
 * decides whether a request reaches them.
 */
export default function ExportsSettingsForm({ exportsEnabled }: { exportsEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(updateExportsSettingsAction, INITIAL_STATE);
  const { show } = useToast();

  useEffect(() => {
    if (state !== INITIAL_STATE && state.error === null) show("Settings saved");
  }, [state, show]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="exportsEnabled" defaultChecked={exportsEnabled} className="h-4 w-4" />
        Exports enabled
      </label>
      <p className="text-xs text-muted">
        Turns the Exports page, the CSV/workbook downloads, and the per-event &ldquo;Export CSV&rdquo; buttons on or
        off for the whole chapter. Currently off while backup storage is being sorted out — nothing is deleted, and
        turning this back on restores every export exactly as it was.
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
