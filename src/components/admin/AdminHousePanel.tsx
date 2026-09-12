"use client";

import HouseCell from "@/components/admin/HouseCell";
import HouseProofViewer from "@/components/admin/HouseProofViewer";
import Badge from "@/components/ui/Badge";
import type { House } from "@/lib/houses";
import type { MemberWithStats } from "@/lib/repo";

type HouseMember = Pick<MemberWithStats, "email" | "house" | "houseState" | "houseProofFileId" | "firstName" | "lastName">;

/** Current House, verification state, the uploaded screenshot inline, and the admin correction control (HouseCell — the only path to changing a verified House). */
export default function AdminHousePanel({ member, houses }: { member: HouseMember; houses: House[] }) {
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
      </div>

      {/*
        The screenshot, readable. Clicking it opens the full-size view, which
        carries Verify and Reject alongside the House the member claimed — the
        panel used to put those buttons up here, far from the 160px crop they
        were supposedly a judgement on.

        Rejecting requires a note (see verifications/actions.ts rejectAction),
        which is another reason the decision belongs in the viewer: that is where
        there is room to type one.
      */}
      <div className="flex flex-col gap-2">
        <HouseProofViewer
          subject={{
            email: member.email,
            name: `${member.firstName} ${member.lastName}`.trim() || member.email,
            house: member.house,
            houseProofFileId: member.houseProofFileId,
          }}
          size="lg"
        />
        {member.houseProofFileId ? (
          <p className="text-xs text-muted">
            {member.houseState === "pending"
              ? "Open it to read the House and verify or reject."
              : "Open it to view full size."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
