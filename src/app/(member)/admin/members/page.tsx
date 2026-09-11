import AddMemberForm from "@/components/admin/AddMemberForm";
import AdminNav from "@/components/admin/AdminNav";
import MemberImport from "@/components/admin/MemberImport";
import MembersFilterBar from "@/components/admin/MembersFilterBar";
import MembersTable from "@/components/admin/MembersTable";
import { getCoreFormConfig, getMembersWithStats, type MemberWithStats } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";
import type { Classification, Role, UserStatus } from "@/lib/types";

type TriState = "all" | "yes" | "no";

interface MembersSearchParams {
  q?: string;
  role?: string;
  status?: string;
  eligible?: string;
  dues?: string;
  national?: string;
  house?: string;
  resume?: string;
  classification?: string;
  major?: string;
}

const VALID_ROLES: Role[] = ["general", "eboard", "admin", "guest"];
const VALID_STATUSES: UserStatus[] = ["pending", "active", "suspended"];
const VALID_CLASSIFICATIONS: Classification[] = ["freshman", "sophomore", "junior", "senior", "graduate"];

function asTri(value: string | undefined): TriState {
  return value === "yes" || value === "no" ? value : "all";
}

function matchesTri(value: boolean, filter: TriState): boolean {
  return filter === "all" || (filter === "yes" ? value : !value);
}

/**
 * House is not a yes/no — "verified", "self-reported and awaiting review" and
 * "none on file at all" are three different situations, and the last one is
 * the one an admin needs to be able to FIND. It used to collapse into "not
 * verified" alongside every pending claim, which is why House-less accounts
 * were only ever discovered by accident. The same three states the roster's
 * House column already renders (see getMembersWithStats houseState).
 */
type HouseFilter = "all" | "verified" | "pending" | "missing";

function asHouseFilter(value: string | undefined): HouseFilter {
  // "yes" was the old spelling of this exact filter and still means it. Any
  // other unrecognized value (including the old "no", which lumped pending
  // and missing together and no longer maps onto one option) falls back to
  // "all" rather than silently meaning something narrower than it used to.
  if (value === "yes") return "verified";
  return value === "verified" || value === "pending" || value === "missing" ? value : "all";
}

/** Server-side filtering (Part 5) — the full roster is already one query (getMembersWithStats); this just filters the already-fetched array per request, driven by MembersFilterBar's URL searchParams. */
function filterMembers(members: MemberWithStats[], params: MembersSearchParams): MemberWithStats[] {
  const q = (params.q ?? "").trim().toLowerCase();
  const role = VALID_ROLES.includes(params.role as Role) ? (params.role as Role) : "all";
  const status = VALID_STATUSES.includes(params.status as UserStatus) ? (params.status as UserStatus) : "all";
  const classification = VALID_CLASSIFICATIONS.includes(params.classification as Classification)
    ? (params.classification as Classification)
    : "all";
  const major = params.major ?? "all";
  const eligible = asTri(params.eligible);
  const dues = asTri(params.dues);
  const national = asTri(params.national);
  const house = asHouseFilter(params.house);
  const resume = asTri(params.resume);

  return members
    .filter((m) => role === "all" || m.role === role)
    .filter((m) => status === "all" || m.status === status)
    .filter((m) => classification === "all" || m.classification === classification)
    .filter((m) => major === "all" || m.major === major)
    .filter((m) => matchesTri(m.eligible, eligible))
    // Dues/National filter on the CLAIM, not on verification — "Reported"
    // has always meant "the member said yes," which is also what drives
    // leaderboard eligibility. The roster's glyph now says separately
    // whether anyone checked it (see ClaimStatus).
    .filter((m) => matchesTri(m.duesPaidReported === true, dues))
    .filter((m) => matchesTri(m.nationalMemberReported === true, national))
    .filter((m) => house === "all" || m.houseState === (house === "missing" ? "none" : house))
    .filter((m) => matchesTri(m.resumeFileId !== null, resume))
    .filter(
      (m) =>
        !q ||
        `${m.firstName} ${m.lastName} ${m.email} ${m.studentId} ${m.nsbeMembershipId}`.toLowerCase().includes(q),
    )
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<MembersSearchParams> }) {
  const session = await requireAdmin();
  const params = await searchParams;
  const [members, coreFormConfig] = await Promise.all([
    getMembersWithStats(session.user.orgId),
    getCoreFormConfig(session.user.orgId),
  ]);
  const filtered = filterMembers(members, params);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Members</h1>
        <p className="numeric text-sm text-muted">
          {filtered.length} of {members.length} on the roster
        </p>
      </div>
      <AdminNav active="/admin/members" />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Add a member</h2>
        <AddMemberForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Bulk import</h2>
        <MemberImport />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Roster</h2>
        <MembersFilterBar majors={coreFormConfig.majors} />
        <MembersTable members={filtered} houses={coreFormConfig.houses} />
      </section>
    </main>
  );
}
