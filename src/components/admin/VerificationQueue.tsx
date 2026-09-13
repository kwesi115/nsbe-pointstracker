"use client";

import { useRef, useState, useTransition } from "react";
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
import { HouseProofLightbox, HouseProofThumbnail, type HouseProofSubject } from "@/components/admin/HouseProofViewer";
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

/** Member row -> what the proof viewer needs. One mapping, used by the cell and the queue alike. */
function subjectFor(m: Member): HouseProofSubject {
  return {
    email: m.email,
    name: `${m.firstName} ${m.lastName}`.trim() || m.email,
    house: m.house,
    houseProofFileId: m.houseProofFileId,
  };
}

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

  /**
   * The House screenshot currently open full size, as an index into the House
   * queue — an index rather than an email so next/previous is just ±1, and the
   * position readout ("3 of 12") is the same number.
   *
   * ONE lightbox for the whole tab, not one per row: paging through the pile is
   * the point, and that is only possible if the viewer outlives any single row.
   */
  const [openProofIndex, setOpenProofIndex] = useState<number | null>(null);
  /**
   * A House claim being rejected with no screenshot to look at. Rare — the wizard
   * requires the two together — but reachable for older rows, and such a claim
   * still has to be rejectable. The lightbox owns this for every claim that DOES
   * have an image; this covers the ones that don't.
   */
  const [houseRejectTarget, setHouseRejectTarget] = useState<string | null>(null);
  // The thumbnail that opened it, so focus goes back there on close.
  const proofTriggerRef = useRef<HTMLElement | null>(null);
  // Claims decided in this session. The server has already dropped them from the
  // queue, but this page's props are from the render that fetched it — hiding
  // them keeps the pile honest while an admin works down it.
  const [decided, setDecided] = useState<Set<string>>(new Set());

  const active = tabs.find((t) => t.id === activeTab)!;

  /**
   * The House pile the lightbox pages through: every pending claim that still
   * HAS a screenshot, minus the ones decided a moment ago. Claims with no upload
   * are left out — there is nothing to page to, and the thumbnail says so where
   * it sits.
   */
  const houseQueue: HouseProofSubject[] = house
    .filter((m) => m.houseProofFileId && !decided.has(m.email))
    .map(subjectFor);
  const openProof = openProofIndex === null ? null : (houseQueue[openProofIndex] ?? null);
  /** The rows actually on screen — the active tab minus anything decided a moment ago. */
  const rows = visible(active.members);

  /** Rows still worth showing — see `decided`. */
  function visible(members: Member[]): Member[] {
    return members.filter((m) => !decided.has(m.email));
  }

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
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((m) => m.email))));
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
              activeTab === t.id ? "bg-inverse text-on-inverse" : "bg-surface text-muted hover:text-foreground"
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
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-sm text-foreground">{selected.size} selected</p>
          <Button type="button" onClick={approveSelected} disabled={isPending} className="ml-auto">
            Approve selected
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          Nothing pending here.
        </p>
      ) : (
        <Table>
          <Thead>
            <th className={thClass}>
              <input
                type="checkbox"
                checked={rows.length > 0 && selected.size === rows.length}
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
            {rows.map((m) => (
              <tr key={m.email} className="border-b border-border last:border-0">
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
                    {/* Clicking opens the shared lightbox at this row. */}
                    <HouseProofThumbnail
                      subject={subjectFor(m)}
                      onOpen={(trigger) => {
                        proofTriggerRef.current = trigger;
                        setOpenProofIndex(houseQueue.findIndex((q) => q.email === m.email));
                      }}
                    />
                  </td>
                ) : null}
                <td className={tdClass}>
                  <div className="flex justify-end gap-2">
                    {activeTab === "house" ? (
                      // Rejecting a House claim requires a note (see
                      // verifications/actions.ts rejectAction), and the place to
                      // type one is beside the screenshot being judged — so the
                      // row opens the proof rather than rejecting blind. With no
                      // screenshot there is nothing to review, so it goes straight
                      // to the note.
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isPending}
                        onClick={() => {
                          if (m.houseProofFileId) {
                            setOpenProofIndex(houseQueue.findIndex((q) => q.email === m.email));
                          } else {
                            setHouseRejectTarget(m.email);
                          }
                        }}
                      >
                        {m.houseProofFileId ? "Review" : "Reject"}
                      </Button>
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

      {/* One viewer for the whole House tab. Next/previous walk the pending pile
          without closing and reopening; a decision advances to the next claim,
          or closes when that was the last one. */}
      <HouseProofLightbox
        subject={openProof}
        paging={
          openProofIndex === null
            ? undefined
            : {
                position: openProofIndex + 1,
                total: houseQueue.length,
                onPrevious: openProofIndex > 0 ? () => setOpenProofIndex(openProofIndex - 1) : undefined,
                onNext: openProofIndex < houseQueue.length - 1 ? () => setOpenProofIndex(openProofIndex + 1) : undefined,
              }
        }
        returnFocusTo={proofTriggerRef}
        onClose={() => setOpenProofIndex(null)}
        onDecided={(email) => setDecided((prev) => new Set(prev).add(email))}
      />

      {/* Rejecting a House claim that has no screenshot attached. Same action and
          same required note as the lightbox's Reject — only the image is absent. */}
      <ConfirmDialog<VerificationActionState>
        open={houseRejectTarget !== null}
        title="Reject this House claim?"
        description="There's no screenshot on this claim to check it against. Rejecting clears it and re-asks at their next check-in."
        confirmLabel="Reject House"
        tone="danger"
        action={rejectAction}
        initialState={INITIAL_STATE}
        payload={{ email: houseRejectTarget }}
        reason={{
          label: "Why",
          placeholder: "e.g. No proof submitted",
          help: "Recorded in the admin log against your account.",
        }}
        onCancel={() => setHouseRejectTarget(null)}
        onSuccess={() => {
          show("House rejected");
          if (houseRejectTarget) setDecided((prev) => new Set(prev).add(houseRejectTarget));
          setHouseRejectTarget(null);
        }}
      />

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
