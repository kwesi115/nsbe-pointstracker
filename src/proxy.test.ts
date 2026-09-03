/**
 * Unit tests for the org/guest/member boundary in proxy.ts — no real Postgres
 * needed, getToken() is mocked the same way middleware itself treats it (a
 * cheap JWT decode, never a DB hit). AUTH_SECRET comes from the real .env
 * (see vitest.setup.ts) since guest-pass.ts signs against it directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// AUTH_SECRET lives in .env.local in dev (not loaded by vitest.setup.ts's
// plain `dotenv/config`, which only reads .env) — tests shouldn't depend on
// that file layout anyway, so set a throwaway value directly if one isn't
// already present.
process.env.AUTH_SECRET ||= "test-only-secret-for-proxy-tests";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { createGuestPassValue, GUEST_PASS_COOKIE } from "./lib/guest-pass";
import { ORG_COOKIE } from "./lib/org";
import { proxy } from "./proxy";

const MEMBER_TOKEN = {
  email: "member@bison.howard.edu",
  role: "general",
  orgId: "org-1",
  status: "active",
} as never;

function makeRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const request = new NextRequest(new URL(path, "http://localhost"));
  for (const [key, value] of Object.entries(cookies)) request.cookies.set(key, value);
  return request;
}

function locationPath(res: Response): string {
  const location = res.headers.get("location");
  if (!location) throw new Error("Expected a redirect response");
  return new URL(location).pathname;
}

describe("proxy", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset();
    vi.mocked(getToken).mockResolvedValue(null);
  });

  it.each(["/events", "/dashboard", "/admin"])(
    "redirects a request with neither cookie away from %s to /signin",
    async (path) => {
      const req = makeRequest(path);
      const res = await proxy(req);
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
      expect(locationPath(res)).toBe("/signin");
    },
  );

  it("a guest_pass holder visiting /dashboard lands on /guest/events", async () => {
    const guestPass = createGuestPassValue("org-1");
    const req = makeRequest("/dashboard", { [GUEST_PASS_COOKIE]: guestPass });
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/guest/events");
  });

  it("a guest_pass holder visiting /account lands on /guest/events", async () => {
    const guestPass = createGuestPassValue("org-1");
    const req = makeRequest("/account", { [GUEST_PASS_COOKIE]: guestPass });
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/guest/events");
  });

  it("redirects an expired guest_pass on /guest/events to /guest/join", async () => {
    const sevenHoursAgo = Date.now() - 7 * 60 * 60_000;
    const expired = createGuestPassValue("org-1", sevenHoursAgo);
    const req = makeRequest("/guest/events", { [GUEST_PASS_COOKIE]: expired });
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/guest/join");
  });

  it("redirects a missing guest_pass on /guest/events to /guest/join", async () => {
    const req = makeRequest("/guest/events");
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/guest/join");
  });

  it("lets a valid guest_pass through to /guest/events", async () => {
    const guestPass = createGuestPassValue("org-1");
    const req = makeRequest("/guest/events", { [GUEST_PASS_COOKIE]: guestPass });
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("authenticated user visiting /signin lands on /events", async () => {
    vi.mocked(getToken).mockResolvedValue(MEMBER_TOKEN);
    const req = makeRequest("/signin");
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/events");
  });

  it("authenticated user visiting /join stays on /join (join wizard steps 4-8 run authenticated)", async () => {
    vi.mocked(getToken).mockResolvedValue(MEMBER_TOKEN);
    const req = makeRequest("/join");
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("authenticated user visiting /guest/join lands on /events", async () => {
    vi.mocked(getToken).mockResolvedValue(MEMBER_TOKEN);
    const req = makeRequest("/guest/join");
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/events");
  });

  it("authenticated user visiting /guest/events/[id] directly lands on /events", async () => {
    vi.mocked(getToken).mockResolvedValue(MEMBER_TOKEN);
    const req = makeRequest("/guest/events/some-event");
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/events");
  });

  it("a request carrying both cookies is treated as a member and the pass is dropped", async () => {
    vi.mocked(getToken).mockResolvedValue(MEMBER_TOKEN);
    const guestPass = createGuestPassValue("org-1");
    const req = makeRequest("/events", { [GUEST_PASS_COOKIE]: guestPass });
    const res = await proxy(req);
    expect(res.status).toBe(200);
    const deleted = res.cookies.get(GUEST_PASS_COOKIE);
    expect(deleted?.value ?? "").toBe("");
  });

  it("an ADMIN token flagged mustChangePassword hitting /admin is redirected to /set-password, not let through", async () => {
    vi.mocked(getToken).mockResolvedValue({
      email: "hunsbepres@gmail.com",
      role: "admin",
      orgId: "org-1",
      status: "active",
      mustChangePassword: true,
    } as never);
    const req = makeRequest("/admin");
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/set-password");
  });

  it("preserves the original /admin destination as ?callbackUrl on the /set-password redirect", async () => {
    vi.mocked(getToken).mockResolvedValue({
      email: "hunsbepres@gmail.com",
      role: "admin",
      orgId: "org-1",
      status: "active",
      mustChangePassword: true,
    } as never);
    const req = makeRequest("/admin/settings");
    const res = await proxy(req);
    const location = res.headers.get("location");
    expect(location).toContain("callbackUrl=%2Fadmin%2Fsettings");
  });

  it("redirects /signin to / when the org cookie is missing", async () => {
    const req = makeRequest("/signin");
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/");
  });

  it("redirects /join to / when the org cookie is missing", async () => {
    const req = makeRequest("/join");
    const res = await proxy(req);
    expect(locationPath(res)).toBe("/");
  });

  it("lets /signin through once the org cookie is set", async () => {
    const req = makeRequest("/signin", { [ORG_COOKIE]: "org-1" });
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });
});
