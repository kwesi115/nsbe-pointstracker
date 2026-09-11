/**
 * Renders AccessDenied to static markup with react-dom/server — this repo's
 * vitest runs in the "node" environment with no DOM (same approach as
 * components/ClaimStatus.test.tsx).
 *
 * What these assertions are really protecting: an E-Board member who clicked
 * something that isn't theirs should get a calm, ordinary page that tells them
 * what to ask for. Not an error screen, and not anything that reads as a
 * security incident.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminPageDenied } from "@/lib/access";
import AccessDenied from "./AccessDenied";

function render(denied: AdminPageDenied): string {
  return renderToStaticMarkup(<AccessDenied denied={denied} />);
}

const adminOnly: AdminPageDenied = { ok: false, denial: { kind: "admin" }, canUseAdminHome: true };
const missingGrant: AdminPageDenied = {
  ok: false,
  denial: { kind: "permission", permission: "verifications_write" },
  canUseAdminHome: false,
};
const exportsOff: AdminPageDenied = { ok: false, denial: { kind: "feature", feature: "exports" }, canUseAdminHome: true };

describe("AccessDenied — an EBOARD officer on an ADMIN-only page", () => {
  const html = render(adminOnly);

  it("explains the situation instead of reporting an error", () => {
    expect(html).toContain("You don&#x27;t have access to this page");
    expect(html).toContain("This page is admin-only.");
    expect(html).toContain("ask a current admin to grant it");
  });

  it("is not an error screen", () => {
    expect(html).not.toMatch(/something went wrong|try again|error/i);
  });

  it("offers a way out", () => {
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Back to admin");
    expect(html).toContain('href="/events"');
    expect(html).toContain("Back to events");
  });
});

describe("AccessDenied — naming the specific requirement", () => {
  it("names the missing permission rather than saying admin-only", () => {
    const html = render(missingGrant);
    expect(html).toContain("This page requires the Membership audit permission.");
    expect(html).not.toContain("admin-only");
  });

  it("says a flagged-off surface is turned off, not that they lack a permission", () => {
    const html = render(exportsOff);
    expect(html).toMatch(/turned off/i);
    expect(html).not.toMatch(/permission/i);
  });
});

describe("AccessDenied — tone", () => {
  const all = [render(adminOnly), render(missingGrant), render(exportsOff)];

  // "This is a normal, expected outcome — an E-Board member clicked something
  // they can't use." It must not be dressed up as a security event.
  it("never uses alarm words", () => {
    for (const html of all) {
      expect(html).not.toMatch(/denied|unauthorized|forbidden|violation|blocked|403/i);
    }
  });

  it("uses the muted token and never the alert token", () => {
    for (const html of all) {
      expect(html).toContain("text-muted");
      expect(html).not.toContain("alert");
    }
  });

  it("renders no icon at all, so nothing can read as a lock or a shield", () => {
    for (const html of all) {
      expect(html).not.toContain("<svg");
    }
  });
});

describe("AccessDenied — the way out has to actually work", () => {
  it("drops 'Back to admin' when /admin would deny them too", () => {
    const html = render(missingGrant);
    expect(html).not.toContain("Back to admin");
    // ...but still offers the member-facing page they can definitely reach.
    expect(html).toContain("Back to events");
  });
});
