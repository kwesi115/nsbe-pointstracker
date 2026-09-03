"use client";

import { useTransition } from "react";
import { approveAction, rejectAction } from "@/app/(member)/admin/verifications/actions";
import HouseCell from "@/components/admin/HouseCell";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { House } from "@/lib/houses";
import type { MemberWithStats } from "@/lib/repo";

type HouseMember = Pick<MemberWithStats, "email" | "house" | "houseState" | "houseProofFileId" | "firstName" | "lastName">;

/** Current House, verification state, the uploaded screenshot inline, and the admin correction control (HouseCell — the only path to changing a verified House). */
export default function AdminHousePanel({ member, houses }: { member: HouseMember; houses: House[] }) {
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  function verify() {
    startTransition(async () => {
      const result = await approveAction("house", member.email);
      if (result.error) show(result.error, "error");
      else show("House verified");
    });
  }

  function reject() {
    startTransition(async () => {
      const result = await rejectAction(member.email);
      if (result.error) show(result.error, "error");
      else show("House rejected");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted">Current House</p>
          <div className="flex items-center gap-2">
            <HouseCell member={member} houses={houses} />
            <Badge tone={member.houseState === "verified" ? "signal" : member.houseState === "pending" ? "amber" : "muted"}>
              {member.houseState === "verified" ? "Verified" : member.houseState === "pending" ? "Pending" : "None"}
            </Badge>
          </div>
        </div>
        {member.houseState === "pending" ? (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={reject} disabled={isPending}>
              Reject
            </Button>
            <Button type="button" onClick={verify} disabled={isPending}>
              Verify
            </Button>
          </div>
        ) : null}
      </div>
      {member.houseProofFileId ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated endpoint, not a static asset
        <img
          src={`/api/files/${member.houseProofFileId}`}
          alt={`${member.firstName} ${member.lastName}'s House test result`}
          className="h-40 w-40 rounded-lg border border-line object-cover"
        />
      ) : (
        <p className="text-sm text-muted">No proof uploaded.</p>
      )}
    </div>
  );
}
