"use client";

import { useState } from "react";
import { correctHouseAction, type MemberActionState } from "@/app/(member)/admin/members/actions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { selectClass } from "@/components/ui/Field";
import HouseDot from "@/components/ui/HouseDot";
import { useToast } from "@/components/ui/Toast";
import StatusIcon from "@/components/StatusIcon";
import type { House } from "@/lib/houses";
import type { MemberWithStats } from "@/lib/repo";

const INITIAL_STATE: MemberActionState = { error: null };

/** The only path to change a House once it's verified (Part 6 of the spec) — an admin picks a value, confirms with a note, and it's applied (and marked verified) immediately. */
export default function HouseCell({ member, houses }: { member: Pick<MemberWithStats, "email" | "house" | "houseState">; houses: House[] }) {
  const { show } = useToast();
  // A pending selection isn't applied until a note is confirmed — see correctHouseAction, which requires one.
  const [pendingHouse, setPendingHouse] = useState<string | null>(null);

  const houseIconValue = member.houseState === "verified" ? true : member.houseState === "pending" ? null : false;
  const currentColor = houses.find((h) => h.name === member.house)?.color;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <HouseDot color={pendingHouse ? houses.find((h) => h.name === pendingHouse)?.color : currentColor} />
        <select
          value={pendingHouse ?? member.house ?? ""}
          onChange={(e) => setPendingHouse(e.target.value || null)}
          className={`${selectClass} w-32`}
          aria-label={`House for ${member.email}`}
        >
          <option value="">—</option>
          {houses.map((h) => (
            <option key={h.code} value={h.name}>
              {h.name}
            </option>
          ))}
        </select>
        {member.house ? (
          <StatusIcon value={houseIconValue} labels={{ yes: "Verified", pending: "Pending verification" }} />
        ) : null}
      </div>
      {/* The note and the House both travel in the submission, so the value
          applied is the one that was on screen when Set was pressed — and the
          shared dialog keeps itself open if the server refuses the note. */}
      <ConfirmDialog<MemberActionState>
        open={pendingHouse !== null && pendingHouse !== member.house}
        title={`Set House to ${pendingHouse ?? ""}?`}
        description="An admin correction: this applies immediately and counts as verified. The note is logged against your account."
        confirmLabel="Set House"
        action={correctHouseAction}
        initialState={INITIAL_STATE}
        payload={{ email: member.email, house: pendingHouse }}
        reason={{ label: "Note", placeholder: "Why this House is being corrected" }}
        onCancel={() => setPendingHouse(null)}
        onSuccess={() => {
          show(`House set to ${pendingHouse}`);
          setPendingHouse(null);
        }}
      />
    </div>
  );
}
