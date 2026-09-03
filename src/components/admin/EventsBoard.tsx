"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { selectClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import Countdown from "@/components/Countdown";
import { formatDate, formatDateTime, pluralize } from "@/lib/format";
import { isOpen } from "@/lib/points";
import type { EventCodeAlertState } from "@/lib/rate-limit";
import type { EventWithStats } from "@/lib/repo";
import {
  cancelEventAction,
  clearEventCodeLockAction,
  closeEventAction,
  extendEventAction,
  openEventAction,
  reopenEventAction,
} from "@/app/(member)/admin/events/actions";

const POLL_MS = 15_000;
const DURATIONS = [15, 20, 30, 45, 60];

type EventWithAlert = EventWithStats & { codeAlert: EventCodeAlertState };

export default function EventsBoard({ initialEvents }: { initialEvents: EventWithAlert[] }) {
  const [allEvents, setEvents] = useState(initialEvents);
  const [now, setNow] = useState(() => new Date());
  // EBOARD_ONLY events shouldn't clutter the general list by default (Part 4).
  const [showEboardOnly, setShowEboardOnly] = useState(false);
  const events = showEboardOnly ? allEvents : allEvents.filter((e) => e.audience !== "eboard_only");
  const eboardOnlyCount = allEvents.filter((e) => e.audience === "eboard_only").length;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events");
      if (!res.ok) return;
      const body = await res.json();
      setEvents(
        body.events.map((e: EventWithStats & { date: string | null; opensAt: string | null; closesAt: string | null; openedAt: string | null; createdAt: string | null }) => ({
          ...e,
          date: e.date ? new Date(e.date) : null,
          opensAt: e.opensAt ? new Date(e.opensAt) : null,
          closesAt: e.closesAt ? new Date(e.closesAt) : null,
          openedAt: e.openedAt ? new Date(e.openedAt) : null,
          createdAt: e.createdAt ? new Date(e.createdAt) : null,
        })),
      );
    } catch {
      // Keep showing the last known list — a failed poll shouldn't blank the board.
    }
  }, []);

  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  const open = events.filter((e) => e.status === "scheduled" && isOpen(e, now));
  const past = events.filter(
    (e) => e.status === "canceled" || (e.status === "scheduled" && !isOpen(e, now) && e.closesAt && e.closesAt.getTime() < now.getTime()),
  );
  const scheduled = events.filter((e) => !open.includes(e) && !past.includes(e));

  if (allEvents.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        description="Create the first one to start tracking attendance."
        action={
          <Button href="/admin/events/new" variant="primary">
            Create event
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {eboardOnlyCount > 0 ? (
        <label className="flex min-h-11 w-fit items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={showEboardOnly} onChange={(e) => setShowEboardOnly(e.target.checked)} className="h-4 w-4" />
          Show E-Board-only events ({eboardOnlyCount})
        </label>
      ) : null}
      <Group title="Open now" empty="Nothing is open right now.">
        {open.map((e) => (
          <OpenRow key={e.eventId} event={e} onChanged={refresh} />
        ))}
      </Group>
      <Group title="Scheduled" empty="Nothing scheduled.">
        {scheduled.map((e) => (
          <ScheduledRow key={e.eventId} event={e} onChanged={refresh} />
        ))}
      </Group>
      <Group title="Past" empty="No past events yet.">
        {past.map((e) => (
          <PastRow key={e.eventId} event={e} onChanged={refresh} />
        ))}
      </Group>
    </div>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const hasAny = items.length > 0 && items.some(Boolean);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {hasAny ? <div className="flex flex-col gap-3">{children}</div> : <p className="text-sm text-muted">{empty}</p>}
    </section>
  );
}

function RowShell({
  event,
  right,
  sub,
  banner,
}: {
  event: EventWithStats;
  right: React.ReactNode;
  sub: React.ReactNode;
  banner?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-base font-bold text-ink">
            {event.name}
            {event.audience === "eboard_only" ? <Badge tone="amber">E-Board only</Badge> : null}
          </p>
          <p className="text-sm text-muted">{sub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{right}</div>
      </div>
      {banner}
    </Card>
  );
}

function OpenRow({ event, onChanged }: { event: EventWithAlert; onChanged: () => void }) {
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [closing, setClosing] = useState(false);

  return (
    <RowShell
      event={event}
      sub={
        <>
          <span className="numeric font-semibold text-signal">{pluralize(event.registrationCount, "registration")}</span>
          {event.closesAt ? (
            <>
              {" · closes in "}
              <Countdown to={event.closesAt} className="font-semibold text-ink" />
            </>
          ) : null}
        </>
      }
      banner={
        event.codeAlert.suspicious ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-ink">
            <span className="flex items-center gap-2">
              <ShieldAlert size={16} aria-hidden="true" />
              {event.codeAlert.locked
                ? "Unusual check-in code activity — check-in is paused for this event."
                : "Unusual check-in code activity on this event."}
            </span>
            {event.codeAlert.locked ? (
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await clearEventCodeLockAction(event.eventId);
                    if (result.error) show(result.error, "error");
                    else {
                      show("Lock cleared");
                      onChanged();
                    }
                  })
                }
              >
                Clear lock
              </Button>
            ) : null}
          </div>
        ) : null
      }
      right={
        <>
          <Badge tone="signal">Open</Badge>
          <Button href={`/admin/events/${event.eventId}/display`} variant="secondary">
            Projector
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await extendEventAction(event.eventId, 10);
                if (result.error) show(result.error, "error");
                else {
                  show("Extended +10 min");
                  onChanged();
                }
              })
            }
          >
            +10 min
          </Button>
          <Button type="button" variant="danger" onClick={() => setClosing(true)}>
            Close now
          </Button>
          <ConfirmDialog
            open={closing}
            title="Close this event now?"
            description="Members won't be able to check in anymore. You can reopen it later if needed."
            confirmLabel="Close now"
            tone="danger"
            pending={isPending}
            onCancel={() => setClosing(false)}
            onConfirm={() =>
              startTransition(async () => {
                const result = await closeEventAction(event.eventId);
                if (result.error) show(result.error, "error");
                else {
                  show("Closed");
                  onChanged();
                }
                setClosing(false);
              })
            }
          />
        </>
      }
    />
  );
}

function ScheduledRow({ event, onChanged }: { event: EventWithStats; onChanged: () => void }) {
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [duration, setDuration] = useState(30);
  const [canceling, setCanceling] = useState(false);

  return (
    <RowShell
      event={event}
      sub={
        <>
          {event.category.name} · {formatDate(event.date)}
          {event.status === "draft" ? <> · </> : null}
          {event.status === "draft" ? <Badge tone="muted">Draft</Badge> : null}
        </>
      }
      right={
        <>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={`${selectClass} w-28`}
            aria-label="Open duration"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await openEventAction(event.eventId, duration);
                if (result.error) show(result.error, "error");
                else {
                  show("Opened");
                  onChanged();
                }
              })
            }
          >
            Open now
          </Button>
          <Button href={`/admin/events/${event.eventId}/edit`} variant="secondary">
            Edit
          </Button>
          <Button href={`/admin/events/${event.eventId}/questions`} variant="secondary">
            Questions
          </Button>
          <Button type="button" variant="danger" onClick={() => setCanceling(true)}>
            Cancel
          </Button>
          <ConfirmDialog
            open={canceling}
            title="Cancel this event?"
            description="It stays on record but members won't be able to check in."
            confirmLabel="Cancel event"
            tone="danger"
            pending={isPending}
            onCancel={() => setCanceling(false)}
            onConfirm={() =>
              startTransition(async () => {
                const result = await cancelEventAction(event.eventId);
                if (result.error) show(result.error, "error");
                else {
                  show("Canceled");
                  onChanged();
                }
                setCanceling(false);
              })
            }
          />
        </>
      }
    />
  );
}

function PastRow({ event, onChanged }: { event: EventWithStats; onChanged: () => void }) {
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [duration, setDuration] = useState(30);

  return (
    <RowShell
      event={event}
      sub={
        <>
          {event.status === "canceled" ? (
            <Badge tone="alert">Canceled</Badge>
          ) : (
            <>
              <span className="numeric">{pluralize(event.registrationCount, "registration")}</span>
              {event.closesAt ? <> · closed {formatDateTime(event.closesAt)}</> : null}
            </>
          )}
        </>
      }
      right={
        <>
          <Button href={`/admin/events/${event.eventId}/responses`} variant="secondary">
            Responses
          </Button>
          <a
            href={`/api/admin/export/event/${event.eventId}/csv`}
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink hover:bg-surface-sunken"
          >
            Export CSV
          </a>
          {event.status !== "canceled" ? (
            <>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className={`${selectClass} w-28`}
                aria-label="Reopen duration"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await reopenEventAction(event.eventId, duration);
                    if (result.error) show(result.error, "error");
                    else {
                      show("Reopened");
                      onChanged();
                    }
                  })
                }
              >
                Reopen
              </Button>
            </>
          ) : null}
        </>
      }
    />
  );
}
