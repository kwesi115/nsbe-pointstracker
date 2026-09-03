"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { formatClock } from "@/lib/format";
import type { EventCodeAlertState } from "@/lib/rate-limit";

const POLL_MS = 5000;
const TICK_MS = 200;
const AMBER_THRESHOLD_MS = 5 * 60_000;
const ROTATION_MS = 60_000;

const RING_RADIUS = 90;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface StatusState {
  name: string;
  open: boolean;
  registrationCount: number;
  closesAt: string | null;
  codeAlert: EventCodeAlertState;
}

interface InitialState extends StatusState {
  code: string | null;
  msUntilRotation: number | null;
}

export default function ProjectorClient({ eventId, qrSvg, initial }: { eventId: string; qrSvg: string; initial: InitialState }) {
  const [data, setData] = useState<StatusState>(initial);
  const [code, setCode] = useState<string | null>(initial.code);
  const [reconnecting, setReconnecting] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [ringFraction, setRingFraction] = useState(1);
  const closesAtMs = useRef<number | null>(null);
  const rotatesAtMs = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    closesAtMs.current = initial.closesAt ? new Date(initial.closesAt).getTime() : null;
    rotatesAtMs.current = initial.msUntilRotation !== null ? Date.now() + initial.msUntilRotation : null;

    async function pollStatus() {
      try {
        const res = await fetch(`/api/admin/events/${eventId}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const body: StatusState = await res.json();
        if (cancelled) return;
        // Keep showing the last known values on failure — the room is looking
        // at this screen, a blank/zeroed board reads as broken, not quiet.
        setData(body);
        setReconnecting(false);
        closesAtMs.current = body.closesAt ? new Date(body.closesAt).getTime() : null;
        if (!body.open) {
          setCode(null);
          rotatesAtMs.current = null;
        }
      } catch {
        if (!cancelled) setReconnecting(true);
      }
    }

    async function pollCode() {
      try {
        const res = await fetch(`/api/admin/events/${eventId}/code`, { cache: "no-store" });
        if (res.status === 404) return; // Closed — pollStatus's `open: false` is what drives the UI switch.
        if (!res.ok) throw new Error("bad code");
        const body: { code: string; msUntilRotation: number } = await res.json();
        if (cancelled) return;
        setCode(body.code);
        rotatesAtMs.current = Date.now() + body.msUntilRotation;
      } catch {
        // Keep showing the last known code and let the ring keep draining
        // locally (see the tick loop below) — never blank it.
      }
    }

    function poll() {
      void pollStatus();
      void pollCode();
    }

    poll();
    const pollId = setInterval(poll, POLL_MS);
    const tickId = setInterval(() => {
      setRemainingMs(closesAtMs.current !== null ? Math.max(0, closesAtMs.current - Date.now()) : null);

      if (rotatesAtMs.current !== null) {
        const nowMs = Date.now();
        // Roll the anchor forward locally if polling has fallen behind, so
        // the ring keeps animating in whole-minute steps instead of sticking
        // at empty — the displayed code may go briefly stale, but it's never
        // blank.
        while (rotatesAtMs.current <= nowMs) rotatesAtMs.current += ROTATION_MS;
        setRingFraction(Math.max(0, Math.min(1, (rotatesAtMs.current - nowMs) / ROTATION_MS)));
      } else {
        setRingFraction(1);
      }
    }, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, [eventId, initial]);

  const amber = remainingMs !== null && remainingMs <= AMBER_THRESHOLD_MS;
  const ringOffset = RING_CIRCUMFERENCE * (1 - ringFraction);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-ink px-8 py-12 text-white lg:flex-row lg:gap-20">
      {reconnecting ? (
        <span
          className="fixed right-6 top-6 flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/70"
          role="status"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber" aria-hidden="true" />
          Reconnecting
        </span>
      ) : null}

      {data.codeAlert.suspicious ? (
        <span
          className="fixed left-6 top-6 flex items-center gap-2 rounded-full bg-amber/20 px-3 py-1.5 text-xs font-medium text-amber"
          role="status"
        >
          <ShieldAlert size={14} aria-hidden="true" />
          Unusual check-in code activity
        </span>
      ) : null}

      <div className="flex flex-col items-center gap-6 text-center">
        <p className="text-xl font-medium text-white/70">{data.name}</p>

        {data.open ? (
          <div className="relative flex items-center justify-center">
            <svg viewBox="0 0 200 200" className="h-[26vw] w-[26vw] max-h-72 max-w-72 lg:h-56 lg:w-56 -rotate-90">
              <circle cx="100" cy="100" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
              <circle
                cx="100"
                cy="100"
                r={RING_RADIUS}
                fill="none"
                className="stroke-amber"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringOffset}
                style={{ transition: "stroke-dashoffset 200ms linear" }}
              />
            </svg>
            <div className="numeric absolute text-[18vw] font-semibold leading-none tracking-wider text-amber lg:text-[9vw]" aria-live="off">
              {code ?? "······"}
            </div>
          </div>
        ) : (
          <p className="text-4xl font-semibold text-white/80">Registration closed</p>
        )}

        {data.open && remainingMs !== null ? (
          <p className="numeric text-2xl font-medium text-white/70">
            <span className={amber ? "text-amber" : undefined}>{formatClock(remainingMs)}</span> remaining
          </p>
        ) : null}

        <p className="numeric text-4xl font-semibold text-white">
          {data.registrationCount} <span className="text-lg font-medium text-white/60">checked in</span>
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="w-56 max-w-full rounded-2xl bg-white p-4" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <p className="text-lg font-medium text-white/70">Scan to check in</p>
      </div>
    </div>
  );
}
