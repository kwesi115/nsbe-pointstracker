"use client";

import { useState, useTransition } from "react";
import {
  approveAction,
  bulkApproveAction,
  rejectAction,
  revokeAction,
  type VerificationQueueTab,
} from "@/app/(member)/admin/verifications/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import RevokeDialog from "@/components/admin/RevokeDialog";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import type { Member } from "@/lib/types";

interface Tab {
  id: VerificationQueueTab;
  label: string;
  members: Member[];
}

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

  function approve(email: string) {
    startTransition(async () => {
      const result = await approveAction(activeTab, email);
      if (result.error) show(result.error, "error");
      else show("Verified");
    });
  }

  function reject(email: string) {
    startTransition(async () => {
      const result = await rejectAction(email);
      if (result.error) show(result.error, "error");
      else show("Rejected");
    });
  }

  function confirmRevoke(note: string) {
    if (!revokeTarget || activeTab === "house") return;
    const email = revokeTarget;
    startTransition(async () => {
      const result = await revokeAction(activeTab, email, note);
      if (result.error) show(result.error, "error");
      else show("Revoked");
      setRevokeTarget(null);
    });
  }

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
            {t.members.length > 0 ? <Badge tone={activeTab === t.id ? "muted" : "amber"}>{t.members.length}</Badge> : null}
          </button>
        ))}
      </div>

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
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => (activeTab === "house" ? reject(m.email) : setRevokeTarget(m.email))}
                      disabled={isPending}
                    >
                      {activeTab === "house" ? "Reject" : "Revoke"}
                    </Button>
                    <Button type="button" onClick={() => approve(m.email)} disabled={isPending}>
                      Approve
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <RevokeDialog
        open={revokeTarget !== null}
        title="Revoke this claim?"
        pending={isPending}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
