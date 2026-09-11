// @vitest-environment jsdom
/**
 * The call site the bug was reported against, end to end in the DOM.
 *
 * Before: the confirm handler called the useActionState dispatcher from onClick
 * and closed the dialog itself. React warned, `pending` never flipped, the
 * button stayed enabled for the whole request, and the dialog was gone before
 * the result arrived — so a second click issued a second setup code and the one
 * on screen silently stopped working.
 *
 * The action itself is mocked here; lib/request-claims.test.ts covers what the
 * real one does when two requests arrive anyway.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, doubleClick, flush, gate } from "@/test/dom";

const resetPasswordAction = vi.fn();
vi.mock("@/app/(member)/admin/members/actions", () => ({
  resetPasswordAction: (prev: unknown, formData: FormData) => resetPasswordAction(prev, formData),
}));

import { ToastProvider } from "@/components/ui/Toast";
import ResetPasswordButton from "./ResetPasswordButton";

const CODE = { email: "ada@bison.howard.edu", setupCode: "SETUP-1111" };

function renderButton() {
  return render(
    <ToastProvider>
      <ResetPasswordButton email="ada@bison.howard.edu" />
    </ToastProvider>,
  );
}

// Both the trigger and the dialog's confirm button say "Reset password", which
// is exactly right for the admin and ambiguous for a query — so scope them.
function dialogEl(): HTMLDialogElement {
  const el = document.querySelector("dialog");
  if (!el) throw new Error("no dialog rendered");
  return el as HTMLDialogElement;
}

function trigger(): HTMLButtonElement {
  const outside = screen
    .getAllByRole("button", { name: /Reset password/ })
    .find((b) => !dialogEl().contains(b));
  if (!outside) throw new Error("no trigger button");
  return outside as HTMLButtonElement;
}

function confirm(): HTMLButtonElement {
  return within(dialogEl()).getByRole("button", { name: /Reset password|Working/ }) as HTMLButtonElement;
}

beforeEach(() => {
  resetPasswordAction.mockReset();
});

describe("the reset password button", () => {
  it("disables the confirm button while the reset is in flight", async () => {
    const held = gate();
    resetPasswordAction.mockImplementation(async () => {
      await held.wait;
      return { error: null, result: CODE };
    });

    renderButton();
    await click(trigger());

    const confirmButton = confirm();
    await click(confirmButton);

    expect(confirmButton.disabled).toBe(true);
    expect(confirmButton.textContent).toContain("Working");
    expect(dialogEl().open).toBe(true);

    held.release();
    await flush();
    expect(resetPasswordAction).toHaveBeenCalledTimes(1);
  });

  it("double-clicking confirm issues ONE reset, and shows the code it returned", async () => {
    const held = gate();
    resetPasswordAction.mockImplementation(async () => {
      await held.wait;
      return { error: null, result: CODE };
    });

    renderButton();
    await click(trigger());
    await doubleClick(confirm());

    expect(resetPasswordAction).toHaveBeenCalledTimes(1);
    held.release();
    await flush();

    expect(resetPasswordAction).toHaveBeenCalledTimes(1);
    expect(dialogEl().open).toBe(false);
    expect(screen.getByText("SETUP-1111")).toBeTruthy();
  });

  it("the email travels in the submission, with a request token for the server to collapse duplicates on", async () => {
    resetPasswordAction.mockResolvedValue({ error: null, result: CODE });

    renderButton();
    await click(trigger());
    await click(confirm());
    await flush();

    const submitted = resetPasswordAction.mock.calls[0][1] as FormData;
    expect(submitted.get("email")).toBe("ada@bison.howard.edu");
    expect(String(submitted.get("requestToken")).length).toBeGreaterThan(8);
  });

  it("a failed reset keeps the dialog open with the error, and shows no setup code", async () => {
    resetPasswordAction.mockResolvedValue({ error: "Member not found", result: null });

    renderButton();
    await click(trigger());
    await click(confirm());
    await flush();

    expect(dialogEl().open).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Member not found");
    expect(screen.queryByText("SETUP-1111")).toBeNull();
  });

  it("a collapsed duplicate (no result) does not wipe the code already on screen", async () => {
    resetPasswordAction.mockResolvedValueOnce({ error: null, result: CODE });
    renderButton();
    await click(trigger());
    await click(confirm());
    await flush();
    expect(screen.getByText("SETUP-1111")).toBeTruthy();

    // The server collapsed a repeat: success, but nothing new to show.
    resetPasswordAction.mockResolvedValueOnce({ error: null, result: null });
    await click(trigger());
    await click(confirm());
    await flush();

    expect(screen.getByText("SETUP-1111")).toBeTruthy();
  });
});
