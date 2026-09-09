"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

export interface CodeGateResult {
  ok: boolean;
  error: string | null;
  /** True specifically for EVENT_NOT_OPEN — a different failure than a wrong code, and shown differently: retrying a code can't fix a closed window. */
  eventNotOpen?: boolean;
}

/**
 * The check-in code gate — shared by CheckInFlow (members) and
 * GuestEventForm (guests). Fails fast, before either form renders: a wrong
 * code should fail in two seconds, not after someone has answered every
 * question. `onVerify` is the only thing that differs between the two
 * callers (a fetch to /api/events/[id]/verify-code for members, a server
 * action for guests) — this component only owns the UI and the two-second
 * feedback loop.
 */
export default function CodeGate({
  onVerify,
  onVerified,
}: {
  onVerify: (code: string) => Promise<CodeGateResult>;
  onVerified: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [eventNotOpen, setEventNotOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await onVerify(code);
      if (result.ok) {
        onVerified(code);
        return;
      }
      setError(result.error ?? "That code isn't right.");
      setEventNotOpen(Boolean(result.eventNotOpen));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkin-code" className="text-sm font-medium text-ink">
          Enter the code on the screen
        </label>
        <input
          id="checkin-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          onFocus={(e) => {
            // The numeric keypad can eat a third of a small screen — make sure
            // this field (and not just whatever the browser guesses) is what
            // ends up above it.
            e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" });
          }}
          disabled={pending || eventNotOpen}
          aria-describedby={error ? "checkin-code-error" : undefined}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="000000"
          className={`numeric min-h-16 w-full rounded-xl border border-line bg-white px-4 text-center font-display text-3xl font-bold tracking-[0.3em] text-ink placeholder:text-line focus-visible:border-signal disabled:opacity-50`}
        />
      </div>
      {error ? (
        <p id="checkin-code-error" role="alert" className="text-sm font-medium text-alert">
          {error}
        </p>
      ) : null}
      {!eventNotOpen ? (
        // Sticky, not fixed — stays pinned to the viewport bottom (above the
        // safe area) while this form is in view, so it's reachable without
        // scrolling even with the on-screen keyboard eating a third of a
        // small phone's height, but never floats over unrelated page content
        // once this step is past. Desktop has room to spare — static there.
        <div className="pb-safe-bottom sticky bottom-0 -mx-4 bg-paper px-4 pt-2 md:static md:mx-0 md:bg-transparent md:p-0">
          <Button type="submit" disabled={pending || code.length !== 6} className="w-full">
            {pending ? "Checking…" : "Continue"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
