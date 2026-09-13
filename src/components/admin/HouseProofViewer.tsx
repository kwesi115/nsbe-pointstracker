"use client";

import { ImageOff } from "lucide-react";
import { useRef, useState } from "react";
import { approveAction, rejectAction, type VerificationActionState } from "@/app/(member)/admin/verifications/actions";
import ActionButton from "@/components/ui/ActionButton";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useToast } from "@/components/ui/Toast";

const INITIAL_STATE: VerificationActionState = { error: null };

/** Everything needed about one pending House claim. */
export interface HouseProofSubject {
  email: string;
  name: string;
  /** The House the member selected — the claim the screenshot is checked against. */
  house: string;
  /** Null when they never uploaded one; the thumbnail then says so rather than breaking. */
  houseProofFileId: string | null;
}

/**
 * A House Personality Test screenshot an admin can actually read, and act on.
 *
 * The thumbnail was never broken — every stored file serves correctly through
 * /api/files/[id]. It was unreadable: a 64px `object-cover` crop of a phone
 * screenshot with no way to enlarge it, which makes the House name in the result
 * illegible. That name is the entire point of the verification.
 *
 * Split into three pieces because the audit queue and the member detail page need
 * different shapes of the same thing: the queue wants many thumbnails sharing ONE
 * lightbox so next/previous can walk the pile, while the detail page wants a
 * single self-contained viewer. The decision controls live with the lightbox in
 * both cases, so the workflow — open, read the House, approve or reject — never
 * leaves the image.
 */
export function fileUrlFor(fileId: string): string {
  // Every image in the app goes through the authenticated endpoint, which checks
  // owner-or-EBOARD per request and logs every non-owner view. Never a storage
  // key, never an object URL.
  return `/api/files/${fileId}`;
}

/** The clickable thumbnail, and the two states that are not an image. */
export function HouseProofThumbnail({
  subject,
  size = "sm",
  onOpen,
}: {
  subject: HouseProofSubject;
  size?: "sm" | "lg";
  /** Passed the element that was clicked, so the opener can return focus to it. */
  onOpen: (trigger: HTMLElement) => void;
}) {
  const [failed, setFailed] = useState(false);
  const box = size === "lg" ? "h-40 w-40" : "h-16 w-16";

  // Nothing on record. Said in words, because an admin looking at a broken-image
  // glyph cannot tell "the member skipped the upload" from "the file failed to
  // load" — and those call for opposite responses.
  if (!subject.houseProofFileId) {
    return (
      <div
        className={`flex ${box} flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-surface-raised p-2 text-center`}
      >
        <ImageOff size={16} className="text-muted" aria-hidden="true" />
        <span className="text-[11px] leading-tight text-muted">No screenshot uploaded</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      // The thumbnail is the control, so it says what it does rather than being
      // an image that happens to have a click handler.
      aria-label={`View ${subject.name}'s House test result full size`}
      className={`group relative ${box} overflow-hidden rounded-lg border border-border transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal`}
    >
      {failed ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-raised p-1 text-center">
          <ImageOff size={16} className="text-alert" aria-hidden="true" />
          <span className="text-[11px] leading-tight text-muted">Couldn&apos;t load — open it</span>
        </span>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated endpoint, not a static asset */}
          <img
            src={fileUrlFor(subject.houseProofFileId)}
            alt=""
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
          <span className="absolute inset-x-0 bottom-0 bg-scrim/70 py-0.5 text-[10px] font-semibold text-on-scrim opacity-0 transition-opacity group-hover:opacity-100">
            View full size
          </span>
        </>
      )}
    </button>
  );
}

/**
 * The full-size view, with the claim beside the proof and the decision in reach.
 * Rendered once per surface — the queue points it at whichever row is open.
 */
export function HouseProofLightbox({
  subject,
  paging,
  returnFocusTo,
  onClose,
  onDecided,
}: {
  subject: HouseProofSubject | null;
  paging?: { position: number; total: number; onPrevious?: () => void; onNext?: () => void };
  returnFocusTo?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Called after a successful verify/reject, so the caller can drop the row. */
  onDecided?: (email: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const { show } = useToast();

  // Nothing to show: either no row is open, or the open one has no upload (the
  // thumbnail already explains that case in place).
  if (!subject || !subject.houseProofFileId) return null;
  const claim = { ...subject, houseProofFileId: subject.houseProofFileId };

  /** Verified or rejected: move to the next pending claim, or close if this was the last. */
  function afterDecision() {
    onDecided?.(claim.email);
    if (paging?.onNext) paging.onNext();
    else onClose();
  }

  return (
    <>
      <ImageLightbox
        open
        src={fileUrlFor(claim.houseProofFileId)}
        alt={`${subject.name}'s House Personality Test result`}
        title={subject.name}
        subtitle={
          <>
            Claimed <strong className="font-semibold text-on-scrim">{subject.house || "no House"}</strong> · {subject.email}
          </>
        }
        paging={paging}
        returnFocusTo={returnFocusTo}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
              Reject
            </Button>
            <ActionButton<VerificationActionState>
              action={approveAction}
              initialState={INITIAL_STATE}
              payload={{ tab: "house", email: subject.email }}
              label="Verify House"
              onSuccess={() => {
                show(`${subject.house || "House"} verified for ${subject.name}`);
                afterDecision();
              }}
              onError={(message) => show(message, "error")}
            />
          </>
        }
      />

      {/* Rejecting takes a note — an admin overruling what a member submitted has
          to say why, the same rule revoking a dues or national claim follows.
          Stacks above the lightbox in the browser's top layer, so the proof stays
          visible behind it. */}
      <ConfirmDialog<VerificationActionState>
        open={rejecting}
        title="Reject this House claim?"
        description={`${subject.name} claimed ${subject.house || "no House"}. Rejecting clears it and re-asks at their next check-in.`}
        confirmLabel="Reject House"
        tone="danger"
        action={rejectAction}
        initialState={INITIAL_STATE}
        payload={{ email: subject.email }}
        reason={{
          label: "Why",
          placeholder: "e.g. Screenshot shows a different House",
          help: "Recorded in the admin log against your account.",
        }}
        onCancel={() => setRejecting(false)}
        onSuccess={() => {
          show(`House rejected for ${subject.name}`);
          setRejecting(false);
          afterDecision();
        }}
      />
    </>
  );
}

/** Thumbnail plus its own lightbox, for a page showing exactly one member. */
export default function HouseProofViewer({
  subject,
  size = "lg",
  onDecided,
}: {
  subject: HouseProofSubject;
  size?: "sm" | "lg";
  onDecided?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  return (
    <>
      <HouseProofThumbnail
        subject={subject}
        size={size}
        onOpen={(trigger) => {
          triggerRef.current = trigger;
          setOpen(true);
        }}
      />
      {open ? (
        <HouseProofLightbox
          subject={subject}
          returnFocusTo={triggerRef}
          onClose={() => setOpen(false)}
          onDecided={() => onDecided?.()}
        />
      ) : null}
    </>
  );
}
