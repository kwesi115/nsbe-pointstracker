// @vitest-environment jsdom
/**
 * The no-confirmation half of the same pattern: verify a claim, grant a
 * permission, extend an open event by ten minutes.
 *
 * These buttons previously used `onClick={() => startTransition(async () => …)}`
 * with `disabled={isPending}`, which reports pending correctly but only after a
 * re-render — so two clicks inside one frame both reached the server. For
 * "+10 min" that is +20 minutes, silently.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { click, doubleClick, flush, gate } from "@/test/dom";
import ActionButton from "./ActionButton";
import type { ActionFormState } from "./useActionForm";

/** The shape every server action dispatched through these components has. */
type Action = (prev: ActionFormState, formData: FormData) => Promise<ActionFormState>;

const INITIAL: ActionFormState = { error: null };

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("ActionButton", () => {
  it("fires the action exactly once for a double-click, and is disabled while it runs", async () => {
    const held = gate();
    const action = vi.fn<Action>(async () => {
      await held.wait;
      return { error: null };
    });

    render(
      <ActionButton<ActionFormState>
        action={action}
        initialState={INITIAL}
        payload={{ eventId: "event-1", extraMinutes: 10 }}
        label="+10 min"
      />,
    );

    await doubleClick(button("+10 min"));
    expect(action).toHaveBeenCalledTimes(1);
    expect(button("Working…").disabled).toBe(true);

    held.release();
    await flush();
    expect(action).toHaveBeenCalledTimes(1);
    expect(button("+10 min").disabled).toBe(false);
  });

  it("submits the payload as form fields", async () => {
    const action = vi.fn<Action>(async () => ({ error: null }));
    render(
      <ActionButton<ActionFormState>
        action={action}
        initialState={INITIAL}
        payload={{ eventId: "event-1", extraMinutes: 10 }}
        label="+10 min"
      />,
    );

    await click(button("+10 min"));
    await flush();

    const submitted = action.mock.calls[0][1];
    expect(submitted.get("eventId")).toBe("event-1");
    expect(submitted.get("extraMinutes")).toBe("10");
  });

  it("submits its own child inputs, so the value used is the one on screen", async () => {
    const action = vi.fn<Action>(async () => ({ error: null }));
    render(
      <ActionButton<ActionFormState>
        action={action}
        initialState={INITIAL}
        payload={{ eventId: "event-1" }}
        label="Open now"
      >
        <select name="durationMinutes" defaultValue={45} aria-label="Open duration">
          <option value={30}>30 min</option>
          <option value={45}>45 min</option>
        </select>
      </ActionButton>,
    );

    await click(button("Open now"));
    await flush();
    expect(action.mock.calls[0][1].get("durationMinutes")).toBe("45");
  });

  it("reports a failure to the caller — these live in table rows, so the message goes to a toast", async () => {
    const onError = vi.fn();
    const onSuccess = vi.fn();
    render(
      <ActionButton<ActionFormState>
        action={vi.fn<Action>(async () => ({ error: "Event not found" }))}
        initialState={INITIAL}
        payload={{ eventId: "gone" }}
        label="Reopen"
        onSuccess={onSuccess}
        onError={onError}
      />,
    );

    await click(button("Reopen"));
    await flush();

    expect(onError).toHaveBeenCalledWith("Event not found", { error: "Event not found" });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("every target is at least 44px tall", () => {
    render(<ActionButton<ActionFormState> action={vi.fn<Action>(async () => INITIAL)} initialState={INITIAL} label="Grant" />);
    expect(button("Grant").className).toContain("min-h-11");
  });
});
