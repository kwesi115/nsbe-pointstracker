"use client";

import { useState, useTransition } from "react";
import { correctHouseAction } from "@/app/(member)/admin/members/actions";
import { inputClass, selectClass } from "@/components/ui/Field";
import HouseDot from "@/components/ui/HouseDot";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import StatusIcon from "@/components/StatusIcon";
import type { House } from "@/lib/houses";
import type { MemberWithStats } from "@/lib/repo";

/** The only path to change a House once it's verified (Part 6 of the spec) — an admin picks a value, confirms with a note, and it's applied (and marked verified) immediately. */
export default function HouseCell({ member, houses }: { member: Pick<MemberWithStats, "email" | "house" | "houseState">; houses: House[] }) {
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();
  // A pending selection isn't applied until a note is confirmed — see correctHouseAction, which requires one.
  const [pendingHouse, setPendingHouse] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const houseIconValue = member.houseState === "verified" ? true : member.houseState === "pending" ? null : false;
  const currentColor = houses.find((h) => h.name === member.house)?.color;

  function confirm() {
    if (!pendingHouse || !note.trim()) return;
    const house = pendingHouse;
    startTransition(async () => {
      const result = await correctHouseAction(member.email, house, note);
      if (result.error) show(result.error, "error");
      else show(`House set to ${house}`);
      setPendingHouse(null);
      setNote("");
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <HouseDot color={pendingHouse ? houses.find((h) => h.name === pendingHouse)?.color : currentColor} />
        <select
          value={pendingHouse ?? member.house ?? ""}
          onChange={(e) => setPendingHouse(e.target.value || null)}
          disabled={isPending}
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
      {pendingHouse && pendingHouse !== member.house ? (
        <div className="flex items-center gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (required)"
            className={`${inputClass} w-32 text-xs`}
          />
          <Button type="button" onClick={confirm} disabled={isPending || !note.trim()}>
            Set
          </Button>
          <button
            type="button"
            onClick={() => {
              setPendingHouse(null);
              setNote("");
            }}
            className="text-xs font-semibold text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
