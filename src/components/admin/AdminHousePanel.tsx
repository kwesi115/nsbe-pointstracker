"use client";

import { approveAction, rejectAction, type VerificationActionState } from "@/app/(member)/admin/verifications/actions";
import HouseCell from "@/components/admin/HouseCell";
import ActionButton from "@/components/ui/ActionButton";
import Badge from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import type { House } from "@/lib/houses";
import type { MemberWithStats } from "@/lib/repo";

type HouseMember = Pick<MemberWithStats, "email" | "house" | "houseState" | "houseProofFileId" | "firstName" | "lastName">;

const INITIAL_STATE: VerificationActionState = { error: null };

/** Current House, verification state, the uploaded screenshot inline, and the admin correction control (HouseCell — the only path to changing a verified House). */
export default function AdminHousePanel({ member, houses }: { member: HouseMember; houses: House[] }) {
  const { show } = useToast();

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
            <ActionButton<VerificationActionState>
              action={rejectAction}
              initialState={INITIAL_STATE}
              payload={{ email: member.email }}
              label="Reject"
              variant="secondary"
              onSuccess={() => show("House rejected")}
              onError={(message) => show(message, "error")}
            />
            <ActionButton<VerificationActionState>
              action={approveAction}
              initialState={INITIAL_STATE}
              payload={{ tab: "house", email: member.email }}
              label="Verify"
              onSuccess={() => show("House verified")}
              onError={(message) => show(message, "error")}
            />
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
