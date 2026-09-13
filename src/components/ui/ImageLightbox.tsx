"use client";

import { Minus, Plus, RotateCcw, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Button from "./Button";

/**
 * A full-size view of an uploaded image, for reading a House Personality Test
 * screenshot rather than squinting at a 64px crop of one.
 *
 * Native <dialog> + showModal(), the same choice ConfirmDialog makes and for the
 * same reasons: the browser's top layer (so nothing can render above it),
 * Escape-to-close, and a real focus trap without hand-rolling one. Focus returns
 * to whatever opened it via `returnFocusTo` — explicit rather than relying on the
 * browser, because verifying a claim re-renders the row the thumbnail lives in.
 *
 * The image is always loaded from `src`, which callers point at /api/files/[id] —
 * the authenticated endpoint that checks owner-or-EBOARD per request and logs
 * every non-owner view. There is deliberately no path here that accepts raw
 * bytes, an object URL, or a storage key.
 *
 * ZOOM exists because the screenshots are real: some are 2.5MB phone photos, and
 * at least one on this roster is a 68-byte 1×1 placeholder. Fit-to-viewport is
 * the default; zooming scales from there and dragging pans, so a small or
 * low-resolution capture can still be read.
 */

const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export interface ImageLightboxProps {
  open: boolean;
  /** Must be an /api/files/[id] URL — see the note above. */
  src: string;
  /** Describes the image for a screen reader; also the fallback caption. */
  alt: string;
  /** Shown top-left: who this belongs to, and what they claimed. */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Verify/Reject and anything else that belongs beside the proof. */
  actions?: React.ReactNode;
  /** Queue paging, when the caller has a pile to work through. */
  paging?: {
    position: number;
    total: number;
    onPrevious?: () => void;
    onNext?: () => void;
  };
  /** Focused again on close. Pass the thumbnail that opened this. */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export default function ImageLightbox(props: ImageLightboxProps) {
  const { open, src, alt, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    onClose();
    // The caller hides the dialog by flipping `open`, so the focus restore has to
    // land after that commit.
    requestAnimationFrame(() => props.returnFocusTo?.current?.focus());
  }

  return (
    <dialog
      ref={ref}
      aria-label={alt}
      onCancel={(event) => {
        // Escape. preventDefault so the browser's own close doesn't race the
        // caller's state update — everything closes through one path.
        event.preventDefault();
        close();
      }}
      // Below sm: a full-screen view, matching every other dialog in the app (see
      // ConfirmDialog). Above it, a large inset panel — a screenshot is the
      // content, so it gets nearly the whole viewport either way.
      className="m-0 h-full max-h-none w-full max-w-none border-0 bg-scrim/95 p-0 backdrop:bg-scrim/80 sm:inset-4 sm:m-auto sm:h-[calc(100%-2rem)] sm:w-[calc(100%-2rem)] sm:rounded-2xl"
    >
      {/* Keyed on src so a new image — queue paging, or a different member —
          starts fitted, centred and loading again, without an effect that resets
          three pieces of state on every change. */}
      <LightboxView key={src} {...props} onRequestClose={close} />
    </dialog>
  );
}

function LightboxView({
  src,
  alt,
  title,
  subtitle,
  actions,
  paging,
  onRequestClose,
}: ImageLightboxProps & { onRequestClose: () => void }) {
  const [zoom, setZoom] = useState<number>(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "failed">("loading");
  // Whether a drag is in progress is a rendering concern (cursor, transition), so
  // it is state; the drag ORIGIN is only ever read inside handlers, so it is a ref.
  const [dragging, setDragging] = useState(false);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);

  function zoomBy(direction: 1 | -1) {
    setZoom((current) => {
      const next =
        direction === 1 ? ZOOM_STEPS.find((z) => z > current) : [...ZOOM_STEPS].reverse().find((z) => z < current);
      const clamped = Math.min(Math.max(next ?? current, MIN_ZOOM), MAX_ZOOM);
      // Back to fit means back to centred — a pan offset at 1x would strand the
      // image off to one side with no visible reason why.
      if (clamped === MIN_ZOOM) setOffset({ x: 0, y: 0 });
      return clamped;
    });
  }

  function reset() {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  }

  const canPan = zoom > MIN_ZOOM && loadState === "loaded";

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!canPan) return;
    dragOriginRef.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = dragOriginRef.current;
    if (!origin) return;
    setOffset({ x: event.clientX - origin.x, y: event.clientY - origin.y });
  }

  function endDrag() {
    dragOriginRef.current = null;
    setDragging(false);
  }

  return (
    // The backdrop. A click anywhere that isn't the image or the chrome closes —
    // ::backdrop itself isn't clickable when the dialog fills the screen, so this
    // is the element that has to carry it.
    <div className="flex h-full w-full flex-col" data-testid="lightbox-backdrop" onClick={onRequestClose}>
      {/* Header: whose proof this is, what they claimed, and the way out. */}
      <div
        className="pt-safe-top flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="font-display text-base font-bold text-on-scrim">{title}</p>
          {subtitle ? <p className="text-sm text-on-scrim/70">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {paging ? (
            <div className="flex items-center gap-1">
              <IconButton label="Previous" onClick={paging.onPrevious} disabled={!paging.onPrevious}>
                ‹
              </IconButton>
              <span className="numeric px-1 text-sm text-on-scrim/80" aria-live="polite">
                {paging.position} of {paging.total}
              </span>
              <IconButton label="Next" onClick={paging.onNext} disabled={!paging.onNext}>
                ›
              </IconButton>
            </div>
          ) : null}
          <IconButton label="Close" onClick={onRequestClose}>
            <X size={18} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      {/* The image. Click-through to the backdrop is stopped so dragging to pan
          doesn't dismiss the thing being panned. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 sm:px-5"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: canPan ? (dragging ? "grabbing" : "grab") : "default" }}
      >
        {loadState === "failed" ? (
          <FailedState src={src} />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated endpoint, not a static asset */}
            <img
              src={src}
              alt={alt}
              onLoad={() => setLoadState("loaded")}
              onError={() => setLoadState("failed")}
              draggable={false}
              // Fitted by default (max-h/max-w), scaled from there by zoom.
              className="max-h-full max-w-full select-none object-contain"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transition: dragging ? "none" : "transform 120ms ease-out",
              }}
            />
            {loadState === "loading" ? <p className="absolute text-sm text-on-scrim/70">Loading…</p> : null}
          </>
        )}
      </div>

      {/* Footer: zoom, the escape hatch, and the actions that let an admin decide
          without leaving the image. */}
      <div
        className="pb-safe-bottom flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          <IconButton label="Zoom out" onClick={() => zoomBy(-1)} disabled={zoom <= MIN_ZOOM || loadState !== "loaded"}>
            <Minus size={18} aria-hidden="true" />
          </IconButton>
          <span className="numeric w-12 text-center text-sm text-on-scrim/80" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton label="Zoom in" onClick={() => zoomBy(1)} disabled={zoom >= MAX_ZOOM || loadState !== "loaded"}>
            <Plus size={18} aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Reset zoom"
            onClick={reset}
            disabled={zoom === MIN_ZOOM && offset.x === 0 && offset.y === 0}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </IconButton>
          {/* For anything this viewer handles badly — an unusual format, a huge
              capture, or a browser that wants to do its own thing. */}
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-on-scrim/80 underline underline-offset-2 hover:text-on-scrim"
          >
            <SquareArrowOutUpRight size={14} aria-hidden="true" />
            Open in new tab
          </a>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** 44px minimum target, legible on the dark backdrop. */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg text-on-scrim/85 hover:bg-on-scrim/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * A failed load, told apart from "nothing was uploaded" — which the caller
 * handles before ever opening this (see HouseProofThumbnail). An admin staring at
 * a broken-image glyph cannot tell the two apart, and they call for opposite
 * responses: chase the member, or chase the bug.
 */
function FailedState({ src }: { src: string }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <p className="font-display text-base font-bold text-on-scrim">This image didn&apos;t load</p>
      <p className="text-sm text-on-scrim/70">
        The file is on record, so something went wrong fetching it rather than the member skipping the upload. Try
        opening it directly — and if that fails too, ask them to upload it again.
      </p>
      <Button href={src} variant="secondary" target="_blank" rel="noopener noreferrer">
        Open in new tab
      </Button>
    </div>
  );
}
