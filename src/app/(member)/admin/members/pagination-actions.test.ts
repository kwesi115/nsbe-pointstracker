/**
 * Roster pagination.
 *
 * The failure this guards against is the easy, wrong version of "Show more":
 * loading all 213 members and revealing 20 at a time. That fixes the scroll
 * and nothing else. So what is asserted here is where the work happens —
 * every page is a fresh server query carrying the SAME filters, and the
 * summary counts come from an aggregate, never from the rows on screen.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/repo", () => ({ getMembersPage: vi.fn() }));

import { getMembersPage } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";
import { loadMembersPageAction } from "./pagination-actions";

const getMembersPageMock = getMembersPage as unknown as ReturnType<typeof vi.fn>;
const requireAdminMock = requireAdmin as unknown as ReturnType<typeof vi.fn>;

const ADMIN = { user: { orgId: "org-1", email: "admin@bison.howard.edu", role: "admin" } };

function rows(n: number, prefix = "m") {
  return Array.from({ length: n }, (_, i) => ({ email: `${prefix}${i}@bison.howard.edu` }));
}

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue(ADMIN);
  getMembersPageMock.mockReset().mockResolvedValue({ rows: rows(20, "p2-"), nextCursor: "cursor-40" });
});

describe("loadMembersPageAction", () => {
  it("asks the server for the next page rather than slicing a preloaded set", async () => {
    const { page } = await loadMembersPageAction({ q: "" }, "cursor-20");

    expect(getMembersPageMock).toHaveBeenCalledWith("org-1", { q: "" }, { cursor: "cursor-20" });
    expect(page?.rows).toHaveLength(20);
  });

  // Page two of a search has to be page two of THAT search, across the whole
  // roster — not the next slice of whatever page one happened to contain.
  it("carries the active filters into every page request", async () => {
    const filters = { q: "lovelace", role: "general" as const, tshirt: "L", eligible: "yes" as const };
    await loadMembersPageAction(filters, "cursor-20");

    expect(getMembersPageMock).toHaveBeenCalledWith("org-1", filters, { cursor: "cursor-20" });
  });

  it("passes a null cursor for the first page of a new filter", async () => {
    await loadMembersPageAction({ q: "ada" }, null);
    expect(getMembersPageMock).toHaveBeenCalledWith("org-1", { q: "ada" }, { cursor: null });
  });

  it("reports the end of the roster with a null cursor, which is what hides the button", async () => {
    getMembersPageMock.mockResolvedValue({ rows: rows(7), nextCursor: null });

    const { page } = await loadMembersPageAction({}, "cursor-200");
    expect(page?.nextCursor).toBeNull();
  });

  it("requires an ADMIN", async () => {
    requireAdminMock.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(loadMembersPageAction({}, null)).rejects.toThrow();
    expect(getMembersPageMock).not.toHaveBeenCalled();
  });

  it("scopes every page to the caller's own org", async () => {
    requireAdminMock.mockResolvedValue({ user: { orgId: "org-2", email: "other@x.edu", role: "admin" } });
    await loadMembersPageAction({}, null);
    expect(getMembersPageMock.mock.calls[0][0]).toBe("org-2");
  });
});
