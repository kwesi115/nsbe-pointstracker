"use client";

import { useState, useTransition } from "react";
import {
  approveAction,
  bulkApproveAction,
  rejectAction,
  revokeAction,
  type VerificationActionState,
  type VerificationQueueTab,
} from "@/app/(member)/admin/verifications/actions";
import ActionButton from "@/components/ui/ActionButton";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import type { Member, Role } from "@/lib/types";

interface Tab {
  id: VerificationQueueTab;
  label: string;
  members: Member[];
}

const INITIAL_STATE: VerificationActionState = { error: null };

const ROLE_LABEL: Record<Role, string> = {
  general: "General",
  eboard: "E-Board",
  admin: "Admin",
  guest: "Guest",
};

export default function VerificationQueue({
  dues,
  national,
  house,
}: {
  dues: Member[];
  national: Member[];
  house: Member[];
}) {
  const tabs: Tab[] = [
    { id: "dues", label: "Unverified dues claims", members: dues },
    { id: "national", label: "Unverified national claims", members: national },
    { id: "house", label: "House pending", members: house },
  ];
  const total = dues.length + national.length + house.length;
  const [activeTab, setActiveTab] = useState<VerificationQueueTab>("dues");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  const active = tabs.find((t) => t.id === activeTab)!;

  function switchTab(id: VerificationQueueTab) {
    setActiveTab(id);
    setSelected(new Set());
  }

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === active.members.length ? new Set() : new Set(active.members.map((m) => m.email))));
  }

  // Bulk approve is the one action here still dispatched from a click: it has
  // no form and no single payload — it loops the selection server-side. It is
  // also idempotent (verifying a verified claim changes nothing), so a repeat
  // is harmless where a repeat of revoke or rotate would not be.
  function approveSelected() {
    startTransition(async () => {
      const result = await bulkApproveAction(activeTab, Array.from(selected));
      if (result.error) show(result.error, "error");
      else {
        show(`${selected.size} verified`);
        setSelected(new Set());
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => switchTab(t.id)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${
              activeTab === t.id ? "bg-ink text-white" : "bg-surface text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {/* Always rendered, including at zero. A hidden badge made an
                empty tab ambiguous — "nothing pending" and "the query is
                filtering everything out" looked identical, which is how a
                queue silently missing 31 E-Board claims went unnoticed. */}
            <Badge tone={activeTab === t.id ? "muted" : t.members.length > 0 ? "amber" : "muted"}>{t.members.length}</Badge>
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        {total === 0
          ? "Nothing outstanding — every claim on the roster has been verified or revoked."
          : `${total} claim${total === 1 ? "" : "s"} awaiting review across all three tabs. Every role is included — officers pay dues and hold national memberships too.`}
      </p>

      {selected.size > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
          <p className="text-sm text-ink">{selected.size} selected</p>
          <Button type="button" onClick={approveSelected} disabled={isPending} className="ml-auto">
            Approve selected
          </Button>
        </div>
      ) : null}

      {active.members.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
          Nothing pending here.
        </p>
      ) : (
        <Table>
          <Thead>
            <th className={thClass}>
              <input
                type="checkbox"
                checked={selected.size === active.members.length}
                onChange={toggleAll}
                aria-label="Select all"
                className="h-4 w-4"
              />
            </th>
            <th className={thClass}>Name</th>
            <th className={thClass}>Email</th>
            {/* An admin verifying a claim needs to know whose claim it is —
                an officer's dues are checked against a different record than
                a general member's. */}
            <th className={thClass}>Role</th>
            {activeTab === "national" ? <th className={thClass}>NSBE ID</th> : null}
            {activeTab === "house" ? <th className={thClass}>House</th> : null}
            {activeTab === "house" ? <th className={thClass}>Proof</th> : null}
            <th className={thClass}></th>
          </Thead>
          <tbody>
            {active.members.map((m) => (
              <tr key={m.email} className="border-b border-line last:border-0">
                <td className={tdClass}>
                  <input
                    type="checkbox"
                    checked={selected.has(m.email)}
                    onChange={() => toggle(m.email)}
                    aria-label={`Select ${m.firstName} ${m.lastName}`}
                    className="h-4 w-4"
                  />
                </td>
                <td className={tdClass}>
                  {m.firstName} {m.lastName}
                </td>
                <td className={tdClass}>{m.email}</td>
                <td className={tdClass}>
                  <Badge tone={m.role === "eboard" ? "signal" : m.role === "admin" ? "amber" : "muted"}>{ROLE_LABEL[m.role]}</Badge>
                </td>
                {activeTab === "national" ? <td className={`${tdClass} numeric`}>{m.nsbeMembershipId || "—"}</td> : null}
                {activeTab === "house" ? <td className={tdClass}>{m.house || "—"}</td> : null}
                {activeTab === "house" ? (
                  <td className={tdClass}>
                    {m.houseProofFileId ? (
                      // eslint-disable-next-line @next/next/no-img-element -- authenticated endpoint, not a static asset
                      <img
                        src={`/api/files/${m.houseProofFileId}`}
                        alt={`${m.firstName} ${m.lastName}'s House test result`}
                        className="h-16 w-16 rounded-lg border border-line object-cover"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
                <td className={tdClass}>
                  <div className="flex justify-end gap-2">
                    {activeTab === "house" ? (
                      <ActionButton<VerificationActionState>
                        action={rejectAction}
                        initialState={INITIAL_STATE}
                        payload={{ email: m.email }}
                        label="Reject"
                        variant="secondary"
                        disabled={isPending}
                        onSuccess={() => show("Rejected")}
                        onError={(message) => show(message, "error")}
                      />
                    ) : (
                      <Button type="button" variant="secondary" onClick={() => setRevokeTarget(m.email)} disabled={isPending}>
                        Revoke
                      </Button>
                    )}
                    <ActionButton<VerificationActionState>
                      action={approveAction}
                      initialState={INITIAL_STATE}
                      payload={{ tab: activeTab, email: m.email }}
                      label="Approve"
                      disabled={isPending}
                      onSuccess={() => show("Verified")}
                      onError={(message) => show(message, "error")}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* The shared dialog with its required-note field, in place of the
          hand-rolled RevokeDialog this used to carry. */}
      <ConfirmDialog<VerificationActionState>
        open={revokeTarget !== null}
        title="Revoke this claim?"
        description="This removes them from the leaderboard immediately and re-arms the question at their next check-in. Say why."
        confirmLabel="Revoke"
        tone="danger"
        action={revokeAction}
        initialState={INITIAL_STATE}
        payload={{ tab: activeTab, email: revokeTarget }}
        reason={{
          label: "Why",
          placeholder: "e.g. Payment record doesn't show this member",
          help: "Recorded against the claim and shown on the member's page.",
        }}
        onCancel={() => setRevokeTarget(null)}
        onSuccess={() => {
          show("Revoked");
          setRevokeTarget(null);
        }}
      />
    </div>
  );
}
