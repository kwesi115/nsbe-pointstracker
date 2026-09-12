// @vitest-environment jsdom
/**
 * The full-size image view: how it closes, how it zooms, what it says when the
 * image doesn't load, and that it is a full-screen sheet on a phone.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, flush, pressEscape } from "@/test/dom";
import ImageLightbox from "./ImageLightbox";

const SRC = "/api/files/file_1";

function dialogEl(): HTMLDialogElement {
  const el = document.querySelector("dialog");
  if (!el) throw new Error("no dialog rendered");
  return el as HTMLDialogElement;
}

function renderLightbox(overrides: Partial<React.ComponentProps<typeof ImageLightbox>> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <ImageLightbox
      open
      src={SRC}
      alt="Ada Lovelace's House Personality Test result"
      title="Ada Lovelace"
      subtitle="Claimed House Turing"
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...result, onClose };
}

/** The <img> only reports "loaded" via an event jsdom never fires on its own. */
function imageLoads() {
  fireEvent.load(screen.getByRole("img"));
}

describe("it opens the image at full size through the authenticated endpoint", () => {
  it("renders the image from /api/files/[id] — never a storage key or object URL", () => {
    renderLightbox();
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(SRC);
    expect(img.getAttribute("src")).toMatch(/^\/api\/files\//);
  });

  it("fits the image to the viewport by default", () => {
    renderLightbox();
    const img = screen.getByRole("img");
    expect(img.className).toContain("max-h-full");
    expect(img.className).toContain("max-w-full");
    expect(img.className).toContain("object-contain");
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("names the member and the House they claimed, so the proof can be compared to the claim", () => {
    renderLightbox();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText(/Claimed House Turing/)).toBeTruthy();
  });

  it("offers an escape hatch for anything it handles badly", () => {
    renderLightbox();
    const link = screen.getByRole("link", { name: /Open in new tab/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(SRC);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("every way of closing it", () => {
  it("closes on the close button", async () => {
    const { onClose } = renderLightbox();
    await click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const { onClose } = renderLightbox();
    pressEscape(dialogEl());
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click", async () => {
    const { onClose } = renderLightbox();
    await click(screen.getByTestId("lightbox-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when the image itself is clicked", async () => {
    const { onClose } = renderLightbox();
    await click(screen.getByRole("img"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when a control in the chrome is used", async () => {
    const { onClose } = renderLightbox();
    imageLoads();
    await click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to whatever opened it", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    // Assigned the way HouseProofThumbnail assigns it: the element that was clicked.
    const ref = createRef<HTMLElement>() as { current: HTMLElement | null };
    ref.current = trigger;
    const focus = vi.spyOn(trigger, "focus");

    renderLightbox({ returnFocusTo: ref });
    await click(screen.getByRole("button", { name: "Close" }));
    // The restore is deferred to after the caller's commit.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(focus).toHaveBeenCalled();
  });
});

describe("zoom and pan, for a small or low-resolution capture", () => {
  it("zooms in and back out, and reports the level", async () => {
    renderLightbox();
    imageLoads();

    await click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("150%")).toBeTruthy();
    expect((screen.getByRole("img") as HTMLImageElement).style.transform).toContain("scale(1.5)");

    await click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("cannot zoom below fit, and stops at the maximum", async () => {
    renderLightbox();
    imageLoads();
    expect((screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement).disabled).toBe(true);

    for (let i = 0; i < 6; i++) await click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("400%")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("resets back to fitted and centred", async () => {
    renderLightbox();
    imageLoads();
    await click(screen.getByRole("button", { name: "Zoom in" }));
    await click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeTruthy();
    expect((screen.getByRole("img") as HTMLImageElement).style.transform).toContain("translate(0px, 0px)");
  });

  it("zoom is unavailable until the image has actually loaded", () => {
    renderLightbox();
    expect((screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});

describe("queue paging", () => {
  it("shows the position and moves both ways", async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    renderLightbox({ paging: { position: 3, total: 12, onNext, onPrevious } });

    expect(screen.getByText("3 of 12")).toBeTruthy();
    await click(screen.getByRole("button", { name: "Next" }));
    await click(screen.getByRole("button", { name: "Previous" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("disables the ends of the pile rather than hiding them", () => {
    renderLightbox({ paging: { position: 1, total: 4, onNext: vi.fn() } });
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows no paging chrome when there is no pile", () => {
    renderLightbox();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});

describe("a failed load says what happened", () => {
  it("explains the file is on record but didn't load, rather than showing a broken glyph", async () => {
    renderLightbox();
    fireEvent.error(screen.getByRole("img"));
    await flush();

    expect(screen.getByText(/didn't load/i)).toBeTruthy();
    expect(screen.getByText(/rather than the member skipping the upload/i)).toBeTruthy();
    // The image is gone, so no broken-image icon is left on screen.
    expect(screen.queryByRole("img")).toBeNull();
    // And there is still a way to try.
    expect(screen.getAllByRole("link", { name: /Open in new tab/ }).length).toBeGreaterThan(0);
  });
});

describe("mobile", () => {
  it("is a full-screen sheet below 640px, with 44px targets", () => {
    renderLightbox();
    const classes = dialogEl().className;

    // Full-bleed at phone width; only from sm: does it become an inset panel, so
    // a 375px viewport never applies those rules.
    expect(classes).toContain("h-full");
    expect(classes).toContain("w-full");
    expect(classes).toContain("max-w-none");
    expect(classes).toContain("max-h-none");
    expect(classes).toContain("sm:inset-4");
    expect(classes).not.toMatch(/\bmin-w-/);

    // Clear of the notch and the home indicator.
    expect(document.querySelector(".pt-safe-top")).toBeTruthy();
    expect(document.querySelector(".pb-safe-bottom")).toBeTruthy();

    for (const button of dialogEl().querySelectorAll("button")) {
      expect(button.className).toContain("min-h-11");
    }

    // A real modal dialog: top layer (so it cannot land behind the bottom nav),
    // Escape and a focus trap come from the platform.
    expect(dialogEl().open).toBe(true);
  });
});
