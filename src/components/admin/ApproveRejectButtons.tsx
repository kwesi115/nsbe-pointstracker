"use client";

import { useTransition } from "react";
import { approveMemberAction, rejectMemberAction } from "@/app/(member)/admin/members/actions";
import { useToast } from "@/components/ui/Toast";

export default function ApproveRejectButtons({ email }: { email: string }) {
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await approveMemberAction(email);
            if (result.error) show(result.error, "error");
            else show(`${email} approved`);
          })
        }
        className="min-h-8 rounded border border-line px-2 text-xs font-semibold text-signal hover:bg-signal/10 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await rejectMemberAction(email);
            if (result.error) show(result.error, "error");
            else show(`${email} rejected`);
          })
        }
        className="min-h-8 rounded border border-line px-2 text-xs font-semibold text-alert hover:bg-alert/10 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
