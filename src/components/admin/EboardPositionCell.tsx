"use client";

import { useState, useTransition } from "react";
import { setEboardPositionAction } from "@/app/(member)/admin/members/actions";
import { inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { EmptyValue } from "@/components/StatusIcon";
import type { MemberWithStats } from "@/lib/repo";

/** Free text, only meaningful for an EBOARD row — saves on blur, not per keystroke. */
export default function EboardPositionCell({ member }: { member: Pick<MemberWithStats, "email" | "role" | "eboardPosition"> }) {
  const [value, setValue] = useState(member.eboardPosition);
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  if (member.role !== "eboard") return <EmptyValue label="Not an E-Board member" />;

  function save() {
    if (value === member.eboardPosition) return;
    startTransition(async () => {
      const result = await setEboardPositionAction(member.email, value);
      if (result.error) show(result.error, "error");
    });
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      disabled={isPending}
      placeholder="e.g. President"
      aria-label={`E-Board position for ${member.email}`}
      className={`${inputClass} w-36`}
    />
  );
}
