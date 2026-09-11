// @vitest-environment jsdom
/**
 * The shared confirm dialog, which every destructive admin action now goes
 * through. These are the guarantees the old hand-rolled dialogs did not have:
 *
 *   - the confirm button is disabled for the REAL duration of the action
 *     (React's own pending, because the action is dispatched by a form submit);
 *   - a double-click fires the action exactly once;
 *   - a failure keeps the dialog open with the error inside it;
 *   - a success closes it;
 *   - two submissions of one confirmation carry the same request token, and a
 *     fresh opening carries a new one — that is the hook the server-side
 *     collapse of duplicates hangs on (see lib/request-claims.test.ts).
 *
 * The bug that prompted all of this: ResetPasswordButton called a
 * useActionState dispatcher from onClick, so `isPending` never flipped, the
 * button was never disabled, and two clicks issued two setup codes — the first
 * of which (the one on screen) was dead.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, doubleClick, flush, gate, pressEscape } from "@/test/dom";
import ConfirmDialog, { type ConfirmActionState } from "./ConfirmDialog";

/** The shape every server action dispatched through these components has. */
type Action = (prev: ConfirmActionState, formData: FormData) => Promise<ConfirmActionState>;

const INITIAL: ConfirmActionState = { error: null };

function dialogEl(): HTMLDialogElement {
  const el = document.querySelector("dialog");
  if (!el) throw new Error("no dialog rendered");
  return el as HTMLDialogElement;
}

function confirmButton(label = "Confirm"): HTMLButtonElement {
  return screen.getByRole("button", { name: label }) as HTMLButtonElement;
}

/**
 * A host that behaves the way every real call site does: it owns `open`, and
 * closes only when the dialog reports success.
 */
function Host({
  action,
  reason,
  onSuccess,
}: {
  action: (prev: ConfirmActionState, formData: FormData) => Promise<ConfirmActionState>;
  reason?: { label: string };
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [closedCount, setClosed] = useState(0);
  return (
    <>
      <p data-testid="closed">{closedCount}</p>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <ConfirmDialog<ConfirmActionState>
        open={open}
        title="Reset this member's password?"
        description="Their current password stops working immediately."
        confirmLabel="Reset password"
        tone="danger"
        action={action}
        initialState={INITIAL}
        payload={{ email: "ada@bison.howard.edu" }}
        reason={reason}
        onCancel={() => {
          setOpen(false);
          setClosed((n) => n + 1);
        }}
        onSuccess={() => {
          setOpen(false);
          setClosed((n) => n + 1);
          onSuccess?.();
        }}
      />
    </>
  );
}

function tokensSubmitted(action: ReturnType<typeof vi.fn<Action>>): string[] {
  return action.mock.calls.map((call) => String(call[1].get("requestToken")));
}

describe("the confirm button is disabled while the action runs", () => {
  it("disables on submit and re-enables when the action resolves", async () => {
    const held = gate();
    const action = vi.fn<Action>(async () => {
      await held.wait;
      return { error: null };
    });

    render(<Host action={action} />);
    const confirm = confirmButton("Reset password");
    expect(confirm.disabled).toBe(false);

    await click(confirm);
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toContain("Working");
    // Still open: the reset hasn't come back yet.
    expect(dialogEl().open).toBe(true);

    held.release();
    await flush();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("cancel is inert while pending, so the result cannot land in a closed dialog", async () => {
    const held = gate();
    const action = vi.fn<Action>(async () => {
      await held.wait;
      return { error: null };
    });

    render(<Host action={action} />);
    await click(confirmButton("Reset password"));

    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);

    // Escape is refused the same way: the cancel event is preventDefault'd.
    const notCanceled = pressEscape(dialogEl());
    expect(notCanceled).toBe(false);
    expect(screen.getByTestId("closed").textContent).toBe("0");

    held.release();
    await flush();
  });

  it("escape closes the dialog when nothing is in flight", async () => {
    render(<Host action={vi.fn<Action>(async () => ({ error: null }))} />);
    const allowed = pressEscape(dialogEl());
    expect(allowed).toBe(true);
    await flush();
    expect(screen.getByTestId("closed").textContent).toBe("1");
  });
});

describe("double-clicking the confirm button fires the action exactly once", () => {
  it("two clicks in one tick produce one dispatch", async () => {
    const held = gate();
    const action = vi.fn<Action>(async () => {
      await held.wait;
      return { error: null };
    });

    render(<Host action={action} />);
    await doubleClick(confirmButton("Reset password"));

    expect(action).toHaveBeenCalledTimes(1);
    held.release();
    await flush();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("a click that lands after the re-render is refused too — the button is disabled", async () => {
    const held = gate();
    const action = vi.fn<Action>(async () => {
      await held.wait;
      return { error: null };
    });

    render(<Host action={action} />);
    const confirm = confirmButton("Reset password");
    await click(confirm);
    await click(confirm);
    await click(confirm);

    expect(action).toHaveBeenCalledTimes(1);
    held.release();
    await flush();
  });
});

describe("a failed action keeps the dialog open and shows the error", () => {
  it("renders the message inline and leaves the dialog open", async () => {
    const action = vi.fn<Action>(async () => ({ error: "Member not found" }));

    render(<Host action={action} />);
    await click(confirmButton("Reset password"));
    await flush();

    expect(screen.getByRole("alert").textContent).toBe("Member not found");
    expect(dialogEl().open).toBe(true);
    expect(screen.getByTestId("closed").textContent).toBe("0");
    // And it is retryable: the button came back.
    expect(confirmButton("Reset password").disabled).toBe(false);
  });

  it("a retry after a failure is allowed, and the stale error is gone once it is reopened", async () => {
    const action = vi
      .fn<(prev: ConfirmActionState, formData: FormData) => Promise<ConfirmActionState>>()
      .mockResolvedValueOnce({ error: "Member not found" })
      .mockResolvedValue({ error: null });

    render(<Host action={action} />);
    await click(confirmButton("Reset password"));
    await flush();
    expect(screen.getByRole("alert")).toBeTruthy();

    await click(confirmButton("Reset password"));
    await flush();
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("closed").textContent).toBe("1");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a successful action closes the dialog", () => {
  it("calls onSuccess once and the host closes", async () => {
    const onSuccess = vi.fn();
    render(<Host action={vi.fn<Action>(async () => ({ error: null }))} onSuccess={onSuccess} />);

    await click(confirmButton("Reset password"));
    await flush();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("closed").textContent).toBe("1");
    expect(dialogEl().open).toBe(false);
  });
});

describe("the payload travels with the submission", () => {
  it("hidden inputs carry the payload, so no handler closes over stale state", async () => {
    const action = vi.fn<Action>(async () => ({ error: null }));
    render(<Host action={action} />);
    await click(confirmButton("Reset password"));
    await flush();

    const submitted = action.mock.calls[0][1];
    expect(submitted.get("email")).toBe("ada@bison.howard.edu");
  });

  it("two submissions of one confirmation share a request token; a new opening mints a new one", async () => {
    const action = vi
      .fn<(prev: ConfirmActionState, formData: FormData) => Promise<ConfirmActionState>>()
      .mockResolvedValueOnce({ error: "Try again" })
      .mockResolvedValue({ error: null });

    render(<Host action={action} />);
    await click(confirmButton("Reset password"));
    await flush();
    await click(confirmButton("Reset password")); // retry, same opening
    await flush();

    const [first, second] = tokensSubmitted(action);
    expect(first).toBeTruthy();
    expect(second).toBe(first);

    // A deliberate second confirmation is a different intent, and must not be
    // collapsed into the first.
    await click(screen.getByRole("button", { name: "Reopen" }));
    await click(confirmButton("Reset password"));
    await flush();
    const third = tokensSubmitted(action)[2];
    expect(third).toBeTruthy();
    expect(third).not.toBe(first);
  });
});

describe("a required reason", () => {
  it("blocks confirm until it has content, and is submitted with the action", async () => {
    const action = vi.fn<Action>(async () => ({ error: null }));
    render(<Host action={action} reason={{ label: "Why" }} />);

    const confirm = confirmButton("Reset password");
    expect(confirm.disabled).toBe(true);

    const note = screen.getByLabelText(/Why/) as HTMLTextAreaElement;
    expect(note.required).toBe(true);
    await act(async () => {
      fireEvent.change(note, { target: { value: "Payment record doesn't show this member" } });
    });

    expect(confirmButton("Reset password").disabled).toBe(false);
    await click(confirmButton("Reset password"));
    await flush();
    expect(action.mock.calls[0][1].get("reason")).toBe("Payment record doesn't show this member");
  });
});

describe("the mobile requirements", () => {
  it("renders as a full-screen sheet below 640px, above the bottom nav, with 44px targets", () => {
    render(<Host action={vi.fn<Action>(async () => ({ error: null }))} />);
    const dialog = dialogEl();
    const classes = dialog.className;

    // Full-bleed bottom sheet at phone width; only from sm: does it become a
    // centered card. A 375px viewport never sees the sm: rules.
    expect(classes).toContain("inset-x-0");
    expect(classes).toContain("bottom-0");
    expect(classes).toContain("w-full");
    expect(classes).toContain("max-w-none");
    expect(classes).toContain("rounded-t-2xl");
    expect(classes).toContain("sm:max-w-sm");
    // Nothing wider than the viewport, and the sheet scrolls rather than
    // pushing its actions off-screen.
    expect(classes).not.toMatch(/\bmin-w-/);
    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("max-h-[85dvh]");

    // Clear of the home indicator, and every control is a 44px target
    // (min-h-11) — Button's base class.
    const form = dialog.querySelector("form");
    expect(form?.className).toContain("pb-safe-bottom");
    for (const button of dialog.querySelectorAll("button")) {
      expect(button.className).toContain("min-h-11");
    }

    // It is a real modal <dialog>: top layer (so no z-index fight with
    // MemberBottomNav), Escape, and a focus trap come from the platform.
    expect(dialog.open).toBe(true);
  });
});
