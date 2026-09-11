"use client";

import { useState } from "react";
import { setRoleAction, type MemberActionState } from "@/app/(member)/admin/members/actions";
import { selectClass } from "@/components/ui/Field";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { Role } from "@/lib/types";

const LABEL: Record<Role, string> = { admin: "Admin", general: "General", eboard: "E-Board", guest: "Guest" };
const INITIAL_STATE: MemberActionState = { error: null };

export default function RoleSelect({ email, role }: { email: string; role: Role }) {
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const { show } = useToast();

  // Both boards are derived at read time from current role, not stored — so
  // a role change is always immediately retroactive across a member's whole
  // history. Say so explicitly for a move into/out of the internal track
  // (EBOARD or ADMIN), since that's the one that moves someone between two
  // entirely different point totals.
  const onInternalTrack = (r: Role) => r === "eboard" || r === "admin";
  const movingToInternal = pendingRole !== null && onInternalTrack(pendingRole) && !onInternalTrack(role);
  const movingFromInternal = onInternalTrack(role) && pendingRole !== null && !onInternalTrack(pendingRole);

  return (
    <>
      <select
        value={role}
        onChange={(e) => setPendingRole(e.target.value as Role)}
        className={`${selectClass} w-32`}
        aria-label={`Role for ${email}`}
      >
        <option value="general">General</option>
        <option value="eboard">E-Board</option>
        <option value="admin">Admin</option>
        <option value="guest">Guest</option>
      </select>

      <ConfirmDialog<MemberActionState>
        open={pendingRole !== null}
        title={`Change role to ${pendingRole ? LABEL[pendingRole] : ""}?`}
        description={
          movingToInternal ? (
            <>
              This takes effect immediately: they drop off the public leaderboard, and their <strong>entire past
              attendance history</strong> — every event that still counts toward the internal E-Board track — is
              retroactively pulled onto the internal board with no backfill needed. Only E-Board/Admin sees that board.
            </>
          ) : movingFromInternal ? (
            <>
              This takes effect immediately: they drop off the internal E-Board board and appear on the public
              member leaderboard instead, with their historical registrations rescored under member rules (whatever
              points were recorded at the time — most internal-track attendance earned 0 member points, since only
              General members earn them).
            </>
          ) : (
            <>
              Only General members earn points. This takes effect on the leaderboard immediately — standings are
              always computed from each member&apos;s <strong>current</strong> role, not the role they had when they
              attended past events.
            </>
          )
        }
        confirmLabel="Change role"
        action={setRoleAction}
        initialState={INITIAL_STATE}
        // The new role travels in the submission, so it cannot be read from
        // stale state by a handler that fired twice.
        payload={{ email, role: pendingRole }}
        onCancel={() => setPendingRole(null)}
        onSuccess={() => {
          show(`${email} is now ${pendingRole ? LABEL[pendingRole] : ""}`);
          setPendingRole(null);
        }}
      />
    </>
  );
}
