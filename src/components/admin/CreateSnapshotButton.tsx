"use client";

import { Camera } from "lucide-react";
import { createSnapshotFormAction, type CreateSnapshotResult } from "@/app/(member)/admin/exports/actions";
import ActionButton from "@/components/ui/ActionButton";
import { useToast } from "@/components/ui/Toast";

const INITIAL_STATE: CreateSnapshotResult = { error: null };

/** Layer 2's manual trigger (see docs/RECOVERY.md) — also reusable as the "snapshot before a destructive action" prompt, which passes its own `reason` and doesn't render this default label. */
export default function CreateSnapshotButton({
  label = "Create season snapshot",
  reason,
  onDone,
}: {
  label?: string;
  reason?: string;
  onDone?: () => void;
}) {
  const { show } = useToast();

  return (
    <ActionButton<CreateSnapshotResult>
      action={createSnapshotFormAction}
      initialState={INITIAL_STATE}
      payload={{ reason }}
      variant="secondary"
      label={
        <>
          <Camera size={16} aria-hidden="true" /> {label}
        </>
      }
      pendingLabel={
        <>
          <Camera size={16} aria-hidden="true" /> Creating…
        </>
      }
      onSuccess={() => {
        show("Snapshot created");
        onDone?.();
      }}
      onError={(message) => show(message, "error")}
    />
  );
}
