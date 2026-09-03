"use client";

import { useTransition } from "react";
import { Camera } from "lucide-react";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createSnapshotAction } from "@/app/(member)/admin/exports/actions";

/** Layer 2's manual trigger (see docs/RECOVERY.md) — also reusable as the "snapshot before a destructive action" prompt (see MemberImport.tsx), which passes its own `reason` and doesn't render this default label. */
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
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await createSnapshotAction(reason);
          if (result.error) show(result.error, "error");
          else {
            show("Snapshot created");
            onDone?.();
          }
        })
      }
    >
      <Camera size={16} aria-hidden="true" /> {isPending ? "Creating…" : label}
    </Button>
  );
}
