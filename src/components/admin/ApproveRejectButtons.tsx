"use client";

import { approveMemberAction, rejectMemberAction, type MemberActionState } from "@/app/(member)/admin/members/actions";
import ActionButton from "@/components/ui/ActionButton";
import { useToast } from "@/components/ui/Toast";

const INITIAL_STATE: MemberActionState = { error: null };

// Approving is idempotent (the member ends up ACTIVE either way), but both
// buttons still dispatch through a form submit so `pending` is real and a
// double-click can't send Approve and Reject's own request racing behind it.
const SMALL_BUTTON = "min-h-8 rounded border border-line px-2 text-xs font-semibold disabled:opacity-50";

export default function ApproveRejectButtons({ email }: { email: string }) {
  const { show } = useToast();

  return (
    <div className="flex gap-2">
      <ActionButton<MemberActionState>
        action={approveMemberAction}
        initialState={INITIAL_STATE}
        payload={{ email }}
        label="Approve"
        variant="ghost"
        className={`${SMALL_BUTTON} text-signal hover:bg-signal/10`}
        onSuccess={() => show(`${email} approved`)}
        onError={(message) => show(message, "error")}
      />
      <ActionButton<MemberActionState>
        action={rejectMemberAction}
        initialState={INITIAL_STATE}
        payload={{ email }}
        label="Reject"
        variant="ghost"
        className={`${SMALL_BUTTON} text-alert hover:bg-alert/10`}
        onSuccess={() => show(`${email} rejected`)}
        onError={(message) => show(message, "error")}
      />
    </div>
  );
}
