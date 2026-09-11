/**
 * The export endpoints under the EXPORTS_ENABLED flag.
 *
 * Two things are being pinned down. First, a gated endpoint answers 403, not
 * 500 and not a blank page — the export generators are still there and still
 * work, the request simply never reaches them. Second, an API route stays an
 * API route: a refusal is JSON { code, message }, never the HTML of the
 * access-denied page. That page is for Server Components; a fetch() caller
 * gets a body it can read (see components/admin/MembersTable.tsx, which
 * surfaces `message` verbatim).
 *
 * Only the session/roster/flag reads are mocked, so the real requireAccess and
 * the real withApiErrors wrapper both run.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/types";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/repo", () => ({ getRole: vi.fn(), getActivePermissions: vi.fn() }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: vi.fn() }));
// The generators themselves are irrelevant here — the point is that a gated
// request never gets to them. Stubbed so the test can assert exactly that.
vi.mock("@/lib/export/workbook", () => ({ buildWorkbookExport: vi.fn() }));
vi.mock("@/lib/export/csv", () => ({
  buildLeaderboardCsv: vi.fn(),
  buildEboardLeaderboardCsv: vi.fn(),
  buildEventResponsesCsv: vi.fn(),
  buildMembersCsv: vi.fn(),
}));

import { buildEventResponsesCsv, buildLeaderboardCsv, buildMembersCsv } from "@/lib/export/csv";
import { buildWorkbookExport } from "@/lib/export/workbook";
import { isFeatureEnabled } from "@/lib/features";
import { getActivePermissions, getRole } from "@/lib/repo";
import { requireSession } from "@/lib/session";

import { GET as getWorkbook } from "./workbook/route";
import { GET as getLeaderboardCsv } from "./leaderboard/csv/route";
import { GET as getEventCsv } from "./event/[id]/csv/route";
import { POST as postMembersCsv } from "./members/csv/route";

const requireSessionMock = requireSession as unknown as ReturnType<typeof vi.fn>;
const getRoleMock = getRole as unknown as ReturnType<typeof vi.fn>;
const getActivePermissionsMock = getActivePermissions as unknown as ReturnType<typeof vi.fn>;
const isFeatureEnabledMock = isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;
const buildWorkbookExportMock = buildWorkbookExport as unknown as ReturnType<typeof vi.fn>;
const buildLeaderboardCsvMock = buildLeaderboardCsv as unknown as ReturnType<typeof vi.fn>;
const buildEventResponsesCsvMock = buildEventResponsesCsv as unknown as ReturnType<typeof vi.fn>;
const buildMembersCsvMock = buildMembersCsv as unknown as ReturnType<typeof vi.fn>;

function signedInAs(role: Role, exportsEnabled: boolean) {
  requireSessionMock.mockResolvedValue({
    user: { email: "officer@bison.howard.edu", orgId: "org-1", role, mustChangePassword: false, status: "active" },
    expires: new Date(Date.now() + 60_000).toISOString(),
  });
  getRoleMock.mockResolvedValue(role);
  getActivePermissionsMock.mockResolvedValue([]);
  isFeatureEnabledMock.mockResolvedValue(exportsEnabled);
}

const generators = [buildWorkbookExportMock, buildLeaderboardCsvMock, buildEventResponsesCsvMock, buildMembersCsvMock];

beforeEach(() => {
  for (const m of [requireSessionMock, getRoleMock, getActivePermissionsMock, isFeatureEnabledMock, ...generators]) {
    m.mockReset();
  }
});

/** Every gated endpoint, each invoked the way its route expects. */
const ENDPOINTS: { name: string; call: () => Promise<Response> }[] = [
  { name: "GET /api/admin/export/workbook", call: async () => getWorkbook() },
  {
    name: "GET /api/admin/export/leaderboard/csv",
    call: async () => getLeaderboardCsv(),
  },
  {
    name: "GET /api/admin/export/event/[id]/csv",
    call: async () =>
      getEventCsv(new Request("http://test/api/admin/export/event/event-1/csv"), {
        params: Promise.resolve({ id: "event-1" }),
      }),
  },
  {
    name: "POST /api/admin/export/members/csv",
    call: async () =>
      postMembersCsv(
        new Request("http://test/api/admin/export/members/csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: ["member@bison.howard.edu"] }),
        }),
      ),
  },
];

describe("export endpoints while EXPORTS_ENABLED is false", () => {
  it.each(ENDPOINTS)("$name answers 403, not 500", async ({ call }) => {
    signedInAs("admin", false);
    const res = await call();
    expect(res.status).toBe(403);
  });

  it.each(ENDPOINTS)("$name answers JSON, never HTML", async ({ call }) => {
    signedInAs("admin", false);
    const res = await call();

    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json();
    expect(body).toMatchObject({ code: "FORBIDDEN" });
    expect(body.message).toMatch(/turned off/i);
    expect(body.message).not.toContain("<");
  });

  it.each(ENDPOINTS)("$name never reaches the export generator", async ({ call }) => {
    signedInAs("admin", false);
    await call();
    for (const generator of generators) expect(generator).not.toHaveBeenCalled();
  });

  it("refuses an EBOARD officer the same way", async () => {
    signedInAs("eboard", false);
    const res = await getWorkbook();
    expect(res.status).toBe(403);
  });

  // The role check answers first, so a GENERAL member is told they lack access
  // rather than which features the org has switched off.
  it("tells a GENERAL member they lack access, not that exports are off", async () => {
    signedInAs("general", false);
    const res = await getWorkbook();
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/E-Board only/i);
  });
});

describe("export endpoints once EXPORTS_ENABLED is true", () => {
  it("runs the workbook generator again", async () => {
    signedInAs("eboard", true);
    buildWorkbookExportMock.mockResolvedValue(Buffer.from("xlsx-bytes"));

    const res = await getWorkbook();
    expect(res.status).toBe(200);
    expect(buildWorkbookExportMock).toHaveBeenCalledWith("org-1");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("runs the leaderboard CSV generator again", async () => {
    signedInAs("eboard", true);
    buildLeaderboardCsvMock.mockResolvedValue({ csv: "rank,name\n1,Ada", filename: "leaderboard.csv" });

    const res = await getLeaderboardCsv();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("rank,name");
  });

  it("still refuses a GENERAL member — the flag is not a permission", async () => {
    signedInAs("general", true);
    const res = await getWorkbook();
    expect(res.status).toBe(403);
    expect(buildWorkbookExportMock).not.toHaveBeenCalled();
  });
});
