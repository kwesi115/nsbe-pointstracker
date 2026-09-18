"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  previewTrashMemberAction,
  trashMemberAction,
  type TrashActionState,
} from "@/app/(member)/admin/trash/actions";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { pluralize } from "@/lib/format";
import type { TrashMemberPreview } from "@/lib/repo";

const INITIAL_STATE: TrashActionState = { error: null };

/**
 * /admin/members/[id] "Move to trash". The confirmation spells out what
 * disappears (roster, boards, exports, sign-in) and what is only hidden and
 * comes back on restore (registrations, points, adjustments, files) — loaded
 * fresh on open, and Confirm stays disabled until it has been read.
 */
export default function TrashMemberButton({ email }: { email: string }) {
  const router = useRouter();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<TrashMemberPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function openDialog() {
    setOpen(true);
    setPreview(null);
    setError(null);
    startTransition(async () => {
      const result = await previewTrashMemberAction(email);
      setPreview(result.preview);
      setError(result.error);
    });
  }

  return (
    <>
      <Button type="button" variant="danger" onClick={openDialog}>
        Move to trash
      </Button>
      <ConfirmDialog<TrashActionState>
        open={open}
        title="Move this member to the trash?"
        confirmLabel="Move to trash"
        tone="danger"
        action={trashMemberAction}
        initialState={INITIAL_STATE}
        payload={{ email }}
        reason={{ label: "Reason", placeholder: "Duplicate account, left the chapter…", help: "Shown in the trash and recorded in the admin log." }}
        confirmDisabled={!preview || preview.blockedReason !== null}
        onCancel={() => setOpen(false)}
        onSuccess={() => {
          setOpen(false);
          show("Moved to the trash");
          router.push("/admin/members");
        }}
        description={
          error ? (
            <p className="font-medium text-alert">{error}</p>
          ) : !preview ? (
            <p>Working out the impact…</p>
          ) : preview.blockedReason ? (
            <p className="font-medium text-alert">{preview.blockedReason}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-foreground">
                {preview.name} disappears from the Member Directory, both leaderboards, standings and every export, and
                can&apos;t sign in. {preview.activeGrants > 0 ? `${pluralize(preview.activeGrants, "permission grant")} will be revoked (and stay revoked on restore). ` : ""}
              </p>
              <ul className="list-disc pl-5 text-foreground">
                <li>
                  <span className="numeric font-semibold">{pluralize(preview.registrations, "registration")}</span> kept — the
                  events keep their headcount
                </li>
                <li>
                  <span className="numeric font-semibold">{preview.points}</span> points stop counting
                  {preview.activeAdjustments > 0 ? ` (including ${pluralize(preview.activeAdjustments, "adjustment")})` : ""}
                </li>
                {preview.files > 0 ? <li>{pluralize(preview.files, "uploaded file")} kept until permanent deletion</li> : null}
              </ul>
              <p>
                Restoring puts everything back exactly. Otherwise it&apos;s permanently deleted in{" "}
                {pluralize(preview.retentionDays, "day")}.
              </p>
            </div>
          )
        }
      />
    </>
  );
}
