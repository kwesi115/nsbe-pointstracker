/**
 * The DOM half of this suite's harness.
 *
 * Most of vitest.config.ts's world is `environment: "node"` — the repo's tests
 * are repo/DB and pure-logic tests. The few files that need to CLICK something
 * opt into jsdom with a `// @vitest-environment jsdom` docblock and import this
 * module, which supplies the three things jsdom does not:
 *
 *   - act() support (React needs the flag set before it will accept act);
 *   - HTMLDialogElement.showModal/close, which jsdom 30 still doesn't implement
 *     — every dialog in this app is a native <dialog>;
 *   - `gate()`, for holding a server action open so "the button is disabled
 *     while the action runs" is a state a test can actually observe.
 */
import { act } from "react";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

declare global {
  // React reads this to decide whether act() is legal in this environment.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

// jsdom has HTMLDialogElement but not its modal behaviour. Enough of it for a
// test to assert open/closed and for Escape to fire a cancel event.
if (typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return;
    this.open = false;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}

/** A promise a test controls: the action stays in flight until `release()`. */
export function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { wait, release };
}

/** Let React flush the work queued by a resolved action. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Click as a user would: outside act's control, then flushed. */
export async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error("click() got no element");
  await act(async () => {
    (element as HTMLElement).click();
  });
}

/** Two clicks inside ONE tick — the double-click React cannot re-render between. */
export async function doubleClick(element: Element | null): Promise<void> {
  if (!element) throw new Error("doubleClick() got no element");
  await act(async () => {
    (element as HTMLElement).click();
    (element as HTMLElement).click();
  });
}

/** Escape, as the browser delivers it to an open <dialog>. */
export function pressEscape(dialog: HTMLDialogElement): boolean {
  return dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
}
