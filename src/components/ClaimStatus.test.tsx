/**
 * Renders ClaimStatus to static markup with react-dom/server — this repo's
 * vitest runs in the "node" environment with no DOM, and a server render is
 * enough to answer the only question that matters here: does a self-reported
 * claim come out looking like a verified one? It must not.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ClaimStatus from "./ClaimStatus";

const VERIFIED_AT = new Date("2026-09-10T12:00:00Z");

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("ClaimStatus — four states, four distinct renderings", () => {
  const pending = render(<ClaimStatus state="pending" claimLabel="Dues" />);
  const verified = render(<ClaimStatus state="verified" claimLabel="Dues" verifiedAt={VERIFIED_AT} verifiedByName="Ada Lovelace" />);
  const revoked = render(<ClaimStatus state="revoked" claimLabel="Dues" revokedNote="No record of payment" />);
  const none = render(<ClaimStatus state="none" claimLabel="Dues" />);

  // The headline assertion: this is the bug.
  it("a self-reported claim does NOT render the same markup as a verified one", () => {
    expect(pending).not.toBe(verified);
  });

  it("all four states render differently from each other", () => {
    const all = [pending, verified, revoked, none];
    expect(new Set(all).size).toBe(4);
  });

  it("only the verified state says 'verified'", () => {
    expect(verified).toMatch(/verified/i);
    expect(pending).not.toMatch(/: verified/i);
    expect(revoked).not.toMatch(/: verified/i);
    expect(none).not.toMatch(/verified/i);
  });

  it("the pending state announces itself as self-reported and not yet verified", () => {
    expect(pending).toMatch(/self-reported/i);
    expect(pending).toMatch(/not yet verified/i);
  });

  it("a verified claim carries its verifier and date, so 'verified by whom' has an answer", () => {
    expect(verified).toContain("Ada Lovelace");
    expect(verified).toMatch(/2026/);
  });

  it("a revoked claim carries its note", () => {
    expect(revoked).toContain("No record of payment");
  });

  it("the 'none' state is a plain dash, labelled for a screen reader", () => {
    expect(none).toContain("—");
    expect(none).toMatch(/not reported/i);
  });

  it("every state is labelled for a screen reader — a bare glyph conveys nothing", () => {
    for (const markup of [pending, verified, revoked, none]) {
      expect(markup).toMatch(/aria-label="[^"]+"/);
    }
  });
});
