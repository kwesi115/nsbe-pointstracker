import AccessDenied from "../_components/AccessDenied";
import AddMemberForm from "@/components/admin/AddMemberForm";
import AdminNav from "@/components/admin/AdminNav";
import MemberImport from "@/components/admin/MemberImport";
import MembersFilterBar from "@/components/admin/MembersFilterBar";
import MembersTable from "@/components/admin/MembersTable";
import { guardAdminPage } from "@/lib/access-guards";
import { SHIRT_SIZE_OPTIONS } from "@/lib/core-form";
import {
  getCoreFormConfig,
  getMemberAggregates,
  getMembersPage,
  type MemberFilters,
  type MemberHouseFilter,
  type MemberTriFilter,
} from "@/lib/repo";
import type { Classification, Role, ShirtSize, UserStatus } from "@/lib/types";

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
  tshirt?: string;
}

const VALID_ROLES: Role[] = ["general", "eboard", "admin", "guest"];
const VALID_STATUSES: UserStatus[] = ["pending", "active", "suspended"];
const VALID_CLASSIFICATIONS: Classification[] = ["freshman", "sophomore", "junior", "senior", "graduate"];

function asTri(value: string | undefined): MemberTriFilter {
  return value === "yes" || value === "no" ? value : "all";
}

/**
 * House is not a yes/no — "verified", "self-reported and awaiting review" and
 * "none on file at all" are three different situations, and the last one is
 * the one an admin needs to be able to FIND. "yes" was the old spelling of
 * "verified" and still means it; anything else unrecognized falls back to
 * "all" rather than silently meaning something narrower than it used to.
 */
function asHouseFilter(value: string | undefined): MemberHouseFilter {
  if (value === "yes") return "verified";
  return value === "verified" || value === "pending" || value === "missing" ? value : "all";
}

/**
 * URL search params → the filter object the SERVER queries with.
 *
 * Every filter is applied in SQL (see lib/repo.ts memberWhere), not to a
 * preloaded array: searching for a name has to find someone who isn't on the
 * loaded page, and the summary counts have to cover everyone who matches.
 */
function toFilters(params: MembersSearchParams): MemberFilters {
  return {
    q: (params.q ?? "").trim(),
    role: VALID_ROLES.includes(params.role as Role) ? (params.role as Role) : "all",
    status: VALID_STATUSES.includes(params.status as UserStatus) ? (params.status as UserStatus) : "all",
    classification: VALID_CLASSIFICATIONS.includes(params.classification as Classification)
      ? (params.classification as Classification)
      : "all",
    major: params.major ?? "all",
    eligible: asTri(params.eligible),
    dues: asTri(params.dues),
    national: asTri(params.national),
    house: asHouseFilter(params.house),
    resume: asTri(params.resume),
    // "none" is a real, actionable value, not an absent filter: it finds the
    // members holding up an apparel order.
    tshirt: params.tshirt === "none" || SHIRT_SIZE_OPTIONS.includes(params.tshirt as ShirtSize) ? params.tshirt! : "all",
  };
}

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<MembersSearchParams> }) {
  const guard = await guardAdminPage({ level: "admin" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const params = await searchParams;
  const filters = toFilters(params);

  // Three scoped reads instead of the whole roster: one page of rows, the
  // aggregate counts over every matching member (never derived from the loaded
  // rows), and the form config.
  const [page, aggregates, coreFormConfig] = await Promise.all([
    getMembersPage(session.user.orgId, filters),
    getMemberAggregates(session.user.orgId, filters),
    getCoreFormConfig(session.user.orgId),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Members</h1>
        <p className="numeric text-sm text-muted">
          {aggregates.total} matching · {aggregates.eligible} eligible
        </p>
      </div>
      <AdminNav active="/admin/members" access={guard.access} />

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
        <MembersTable
          initialPage={page}
          total={aggregates.total}
          filters={filters}
          houses={coreFormConfig.houses}
          exportsEnabled={guard.access.features.exports}
        />
      </section>
    </main>
  );
}
