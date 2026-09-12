// @vitest-environment jsdom
/**
 * The House proof workflow: open the screenshot, read the House, decide.
 *
 * The thumbnail was never broken — it was a 64px crop with no way to enlarge it,
 * which is what made the House name in the result unreadable. These tests pin the
 * fix: the thumbnail is a control, the full-size view carries the decision, and
 * the two states that are not an image say which one they are.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { click, flush } from "@/test/dom";

const approveAction = vi.fn();
const rejectAction = vi.fn();
vi.mock("@/app/(member)/admin/verifications/actions", () => ({
  approveAction: (...args: unknown[]) => approveAction(...args),
  rejectAction: (...args: unknown[]) => rejectAction(...args),
}));

import { ToastProvider } from "@/components/ui/Toast";
import HouseProofViewer, { HouseProofLightbox, type HouseProofSubject } from "./HouseProofViewer";

const ADA: HouseProofSubject = {
  email: "ada@bison.howard.edu",
  name: "Ada Lovelace",
  house: "House Turing",
  houseProofFileId: "file_1",
};

function renderViewer(subject: HouseProofSubject = ADA, onDecided = vi.fn()) {
  render(
    <ToastProvider>
      <HouseProofViewer subject={subject} onDecided={onDecided} />
    </ToastProvider>,
  );
  return { onDecided };
}

function dialogs(): HTMLDialogElement[] {
  return [...document.querySelectorAll("dialog")] as HTMLDialogElement[];
}

/** The lightbox is the dialog carrying the member's name in its header. */
function lightbox(): HTMLDialogElement {
  const found = dialogs().find((d) => d.getAttribute("aria-label")?.includes("House Personality Test"));
  if (!found) throw new Error("lightbox not rendered");
  return found;
}

function thumbnail(): HTMLButtonElement {
  return screen.getByRole("button", { name: /View .*'s House test result full size/ }) as HTMLButtonElement;
}

beforeEach(() => {
  approveAction.mockReset().mockResolvedValue({ error: null });
  rejectAction.mockReset().mockResolvedValue({ error: null });
});

describe("clicking the thumbnail opens the screenshot full size", () => {
  it("the thumbnail is a button that says what it does, not a bare image", () => {
    renderViewer();
    const trigger = thumbnail();
    expect(trigger.tagName).toBe("BUTTON");
    // The image inside is decorative — the button carries the label.
    expect(trigger.querySelector("img")!.getAttribute("src")).toBe("/api/files/file_1");
  });

  it("opens the full-size view on click", async () => {
    renderViewer();
    expect(dialogs()).toHaveLength(0);

    await click(thumbnail());

    const box = lightbox();
    expect(box.open).toBe(true);
    // Same authenticated endpoint, at full size rather than cropped.
    const img = within(box).getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/files/file_1");
    expect(img.className).toContain("object-contain");
  });

  it("shows the member and the House they claimed beside the proof", async () => {
    renderViewer();
    await click(thumbnail());
    const box = lightbox();
    expect(within(box).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(box).getByText(/House Turing/)).toBeTruthy();
    expect(within(box).getByText(/ada@bison\.howard\.edu/)).toBeTruthy();
  });
});

describe("verify and reject work from inside the lightbox", () => {
  it("Verify approves the House claim without leaving the image", async () => {
    const { onDecided } = renderViewer();
    await click(thumbnail());

    await click(within(lightbox()).getByRole("button", { name: "Verify House" }));
    await flush();

    expect(approveAction).toHaveBeenCalledTimes(1);
    const submitted = approveAction.mock.calls[0][1] as FormData;
    expect(submitted.get("tab")).toBe("house");
    expect(submitted.get("email")).toBe("ada@bison.howard.edu");
    expect(onDecided).toHaveBeenCalled();
  });

  it("Reject asks for a note first, and will not submit without one", async () => {
    renderViewer();
    await click(thumbnail());
    await click(within(lightbox()).getByRole("button", { name: "Reject" }));

    // The confirm dialog stacks above the lightbox, so the proof stays visible.
    const confirm = dialogs().find((d) => d !== lightbox() && d.open);
    expect(confirm).toBeTruthy();
    const submit = within(confirm!).getByRole("button", { name: "Reject House" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(rejectAction).not.toHaveBeenCalled();
  });

  it("Reject submits the note once it is typed", async () => {
    renderViewer();
    await click(thumbnail());
    await click(within(lightbox()).getByRole("button", { name: "Reject" }));

    const confirm = dialogs().find((d) => d !== lightbox() && d.open)!;
    const note = within(confirm).getByLabelText(/Why/) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "Screenshot shows House Curie" } });
    await click(within(confirm).getByRole("button", { name: "Reject House" }));
    await flush();

    expect(rejectAction).toHaveBeenCalledTimes(1);
    const submitted = rejectAction.mock.calls[0][1] as FormData;
    expect(submitted.get("email")).toBe("ada@bison.howard.edu");
    expect(submitted.get("reason")).toBe("Screenshot shows House Curie");
  });

  it("a decision closes the view when there is nothing else to work", async () => {
    renderViewer();
    await click(thumbnail());
    await click(within(lightbox()).getByRole("button", { name: "Verify House" }));
    await flush();
    expect(dialogs().some((d) => d.getAttribute("aria-label")?.includes("House Personality Test"))).toBe(false);
  });
});

describe("next and previous walk the pending pile", () => {
  const QUEUE: HouseProofSubject[] = [
    ADA,
    { email: "grace@bison.howard.edu", name: "Grace Hopper", house: "House Curie", houseProofFileId: "file_2" },
    { email: "kat@bison.howard.edu", name: "Katherine Johnson", house: "House Bell", houseProofFileId: "file_3" },
  ];

  /** A minimal stand-in for the queue: one shared lightbox over an index. */
  function Harness() {
    const [index, setIndex] = useState(0);
    return (
      <ToastProvider>
        <HouseProofLightbox
          subject={QUEUE[index]}
          paging={{
            position: index + 1,
            total: QUEUE.length,
            onPrevious: index > 0 ? () => setIndex(index - 1) : undefined,
            onNext: index < QUEUE.length - 1 ? () => setIndex(index + 1) : undefined,
          }}
          onClose={vi.fn()}
        />
      </ToastProvider>
    );
  }

  it("moves through the queue and reports position", async () => {
    render(<Harness />);
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();

    await click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    // A new image, so the view refits rather than keeping the last one's zoom.
    expect(screen.getByText("100%")).toBeTruthy();

    await click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);

    await click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("2 of 3")).toBeTruthy();
  });
});

describe("the two states that are not an image", () => {
  it("a member who uploaded nothing gets an explanation, not a broken image", () => {
    renderViewer({ ...ADA, houseProofFileId: null });

    expect(screen.getByText(/No screenshot uploaded/i)).toBeTruthy();
    // Nothing to click and nothing to break.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("a file that fails to load says so, distinctly from never having been uploaded", async () => {
    renderViewer();
    fireEvent.error(thumbnail().querySelector("img")!);
    await flush();

    expect(screen.getByText(/Couldn't load/i)).toBeTruthy();
    // Still openable — the full view offers the direct link.
    expect(thumbnail()).toBeTruthy();
  });
});
