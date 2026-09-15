// @vitest-environment jsdom
/**
 * "Resend code" re-displays the member's current code. It must go through the
 * resend action — never the reset action, which would issue a new code and kill
 * the one the member may already have. lib/reset-password.test.ts covers what
 * the real action does to the database (nothing).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, flush } from "@/test/dom";

const resendSetupCodeAction = vi.fn();
const resetPasswordAction = vi.fn();
vi.mock("@/app/(member)/admin/members/actions", () => ({
  resendSetupCodeAction: (prev: unknown, formData: FormData) => resendSetupCodeAction(prev, formData),
  resetPasswordAction: (prev: unknown, formData: FormData) => resetPasswordAction(prev, formData),
}));

import { ToastProvider } from "@/components/ui/Toast";
import ResendSetupCodeButton from "./ResendSetupCodeButton";

const EMAIL = "ada@bison.howard.edu";

function renderButton() {
  return render(
    <ToastProvider>
      <ResendSetupCodeButton email={EMAIL} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  resendSetupCodeAction.mockReset();
  resetPasswordAction.mockReset();
});

describe("the resend code button", () => {
  it("shows the existing code without generating a new one", async () => {
    resendSetupCodeAction.mockResolvedValue({ error: null, result: { email: EMAIL, setupCode: "EXST2345" } });

    renderButton();
    await click(screen.getByRole("button", { name: "Resend code" }));
    await flush();

    expect(screen.getByText("EXST2345")).toBeTruthy();
    expect(screen.getByText(/nothing was reset/i)).toBeTruthy();
    expect(resendSetupCodeAction).toHaveBeenCalledTimes(1);
    expect((resendSetupCodeAction.mock.calls[0][1] as FormData).get("email")).toBe(EMAIL);
    expect(resetPasswordAction).not.toHaveBeenCalled();
  });

  it("says why when there is no code to show", async () => {
    resendSetupCodeAction.mockResolvedValue({ error: "No code to show — this member has already chosen a password.", result: null });

    renderButton();
    await click(screen.getByRole("button", { name: "Resend code" }));
    await flush();

    expect(screen.getByText(/No code to show/)).toBeTruthy();
    expect(resetPasswordAction).not.toHaveBeenCalled();
  });

  it("warns when the email can't sign in at all", async () => {
    resendSetupCodeAction.mockResolvedValue({
      error: null,
      result: { email: "someone@gmail.com", setupCode: "EXST2345", loginBlocked: true },
    });

    renderButton();
    await click(screen.getByRole("button", { name: "Resend code" }));
    await flush();

    expect(screen.getByRole("alert").textContent).toMatch(/can.t sign in/);
  });
});
