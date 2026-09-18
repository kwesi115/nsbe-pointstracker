/**
 * Brings a form field with an error into view and puts focus in it — the
 * check-in form's "scroll to the first errored field".
 *
 * Why not element.scrollIntoView({ block: "center" }): on a phone with the
 * on-screen keyboard open, that centers the field in the LAYOUT viewport,
 * and the lower half of the layout viewport is behind the keyboard — so the
 * field "scrolled into view" lands exactly where the member can't see it.
 * window.visualViewport is the part of the page actually visible above the
 * keyboard; centering in that is the fix.
 *
 * The keyboard can also appear (or go away) just after this runs — focusing a
 * text input on Android opens it — so the field is re-centered once on the
 * next visualViewport resize within a short window.
 *
 * Focus uses preventScroll: the scroll above already placed the field, and a
 * browser's own focus scroll would undo it with the layout-viewport math.
 */

const RESIZE_WINDOW_MS = 1000;

/** The window.scrollY that centers `rect` in the visible viewport. Pure, so the math is testable without a phone. */
export function centeredScrollTop(
  rect: { top: number; height: number },
  scrollY: number,
  viewport: { offsetTop: number; height: number },
): number {
  const elementCenter = scrollY + rect.top + rect.height / 2;
  return Math.max(0, elementCenter - viewport.offsetTop - viewport.height / 2);
}

function visibleViewport(): { offsetTop: number; height: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return vv ? { offsetTop: vv.offsetTop, height: vv.height } : { offsetTop: 0, height: window.innerHeight };
}

export function revealField(container: HTMLElement): void {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const center = (behavior: ScrollBehavior) => {
    const top = centeredScrollTop(container.getBoundingClientRect(), window.scrollY, visibleViewport());
    window.scrollTo({ top, behavior });
  };

  center(reduceMotion ? "auto" : "smooth");

  const control = container.querySelector<HTMLElement>(
    "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
  );
  control?.focus({ preventScroll: true });

  const vv = window.visualViewport;
  if (!vv) return;
  const onResize = () => {
    vv.removeEventListener("resize", onResize);
    center("auto");
  };
  vv.addEventListener("resize", onResize);
  setTimeout(() => vv.removeEventListener("resize", onResize), RESIZE_WINDOW_MS);
}
