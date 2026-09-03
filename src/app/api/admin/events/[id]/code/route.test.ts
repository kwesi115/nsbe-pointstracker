/**
 * Route-handler test — GET is a plain exported async function, so it can be
 * called directly with a constructed Request/ctx, no dev server needed.
 * @/lib/session and @/lib/repo are mocked; @/lib/code runs for real (pure,
 * deterministic, CODE_SECRET comes from the root .env via vitest.setup.ts).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireEboard: vi.fn() }));
vi.mock("@/lib/repo", () => ({ getEvent: vi.fn() }));

import { currentCode } from "@/lib/code";
import { getEvent } from "@/lib/repo";
import { requireEboard } from "@/lib/session";
import { GET } from "./route";

const requireEboardMock = requireEboard as unknown as ReturnType<typeof vi.fn>;
const getEventMock = getEvent as unknown as ReturnType<typeof vi.fn>;

const SESSION = { user: { orgId: "org-1", email: "eboard@bison.howard.edu" } };

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requireEboardMock.mockReset().mockResolvedValue(SESSION);
  getEventMock.mockReset();
});

describe("GET /api/admin/events/[id]/code", () => {
  it("returns the current code and msUntilRotation while the event is open", async () => {
    const now = Date.now();
    getEventMock.mockResolvedValue({
      eventId: "event-1",
      status: "scheduled",
      opensAt: new Date(now - 60_000),
      closesAt: new Date(now + 60_000),
    });

    const res = await GET(new Request("http://test/api/admin/events/event-1/code"), ctxFor("event-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.code).toBe(currentCode("event-1", new Date()));
    expect(typeof body.msUntilRotation).toBe("number");
  });

  it("returns 404 once the registration window has closed", async () => {
    const now = Date.now();
    getEventMock.mockResolvedValue({
      eventId: "event-1",
      status: "scheduled",
      opensAt: new Date(now - 120_000),
      closesAt: new Date(now - 60_000),
    });

    const res = await GET(new Request("http://test/api/admin/events/event-1/code"), ctxFor("event-1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 (via NOT_FOUND) when the event doesn't exist", async () => {
    getEventMock.mockResolvedValue(null);

    const res = await GET(new Request("http://test/api/admin/events/missing/code"), ctxFor("missing"));
    expect(res.status).toBe(404);
  });
});
