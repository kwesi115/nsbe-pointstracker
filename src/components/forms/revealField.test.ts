import { describe, expect, it } from "vitest";
import { centeredScrollTop } from "./revealField";

describe("centeredScrollTop — scroll-to-error with the on-screen keyboard open", () => {
  // An 800px-tall phone. With the keyboard up, only the top 450px are visible.
  const field = { top: 700, height: 60 }; // relative to the layout viewport, page scrolled to 1000

  it("centers the field in the full viewport when there's no keyboard", () => {
    expect(centeredScrollTop(field, 1000, { offsetTop: 0, height: 800 })).toBe(1000 + 730 - 400);
  });

  it("centers it in the part ABOVE the keyboard when the keyboard is open", () => {
    const top = centeredScrollTop(field, 1000, { offsetTop: 0, height: 450 });
    expect(top).toBe(1000 + 730 - 225);
    // After scrolling there, the field sits inside the visible 450px, not behind the keyboard.
    const fieldTopAfter = 1000 + field.top - top;
    expect(fieldTopAfter).toBeGreaterThanOrEqual(0);
    expect(fieldTopAfter + field.height).toBeLessThanOrEqual(450);
  });

  it("accounts for the visual viewport being panned within the layout viewport", () => {
    expect(centeredScrollTop(field, 1000, { offsetTop: 100, height: 450 })).toBe(1000 + 730 - 100 - 225);
  });

  it("never scrolls above the top of the page", () => {
    expect(centeredScrollTop({ top: 10, height: 40 }, 0, { offsetTop: 0, height: 800 })).toBe(0);
  });
});
