import AccessDenied from "../_components/AccessDenied";
import AdminNav from "@/components/admin/AdminNav";
import ResumesFilterBar from "@/components/admin/ResumesFilterBar";
import ResumesTable from "@/components/admin/ResumesTable";
import { RESUME_BUNDLE_ACCESS } from "@/lib/access";
import { guardAdminPage } from "@/lib/access-guards";
import { formatNumber } from "@/lib/format";
import { getCoreFormConfig, getResumeRoster, getResumeRosterCounts, type ResumeFilters } from "@/lib/repo";
import type { Classification } from "@/lib/types";

interface ResumesSearchParams {
  q?: string;
  classification?: string;
  major?: string;
  house?: string;
  eligible?: string;
}

const VALID_CLASSIFICATIONS: Classification[] = ["freshman", "sophomore", "junior", "senior", "graduate"];

/**
 * URL search params -> the filter object the SERVER queries with. Same shape
 * and same discipline as admin/members/page.tsx toFilters: an unrecognized
 * value falls back to "all" rather than to something narrower, because this
 * object is also what gets written to the AdminLog and it must describe the
 * bundle honestly.
 */
function toFilters(params: ResumesSearchParams): ResumeFilters {
  return {
    q: (params.q ?? "").trim(),
    classification: VALID_CLASSIFICATIONS.includes(params.classification as Classification)
      ? (params.classification as Classification)
      : "all",
    major: params.major ?? "all",
    house: params.house ?? "all",
    eligible: params.eligible === "yes" || params.eligible === "no" ? params.eligible : "all",
  };
}

export default async function AdminResumesPage({ searchParams }: { searchParams: Promise<ResumesSearchParams> }) {
  const guard = await guardAdminPage(RESUME_BUNDLE_ACCESS);
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const { orgId } = guard.session.user;
  const filters = toFilters(await searchParams);

  const [counts, rows, coreFormConfig] = await Promise.all([
    getResumeRosterCounts(orgId),
    getResumeRoster(orgId, filters),
    getCoreFormConfig(orgId),
  ]);

  const noConsent = counts.withResume - counts.withConsent;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold text-foreground">Resume bundle</h1>
        {/* The whole reason an E-Board member opens this page, so it is the
            headline rather than a stat tile in a row of four. Deliberately
            unfiltered: it describes the chapter, not the current search. */}
        <p className="numeric text-lg font-semibold text-foreground">
          {formatNumber(counts.withResume)} of {formatNumber(counts.members)} members have a resume on file.
        </p>
        <p className="text-sm text-muted">
          {noConsent > 0 ? (
            <>
              {formatNumber(counts.withConsent)} of those carry a consent timestamp and can be shared.{" "}
              {formatNumber(noConsent)} {noConsent === 1 ? "has" : "have"} no consent on file and{" "}
              {noConsent === 1 ? "is" : "are"} left out of every bundle — they are listed below, flagged.
            </>
          ) : (
            <>
              Every one of them carries a consent timestamp. A member who removes their resume from their account
              withdraws consent at the same moment and drops out of the next download.
            </>
          )}
        </p>
      </div>

      <AdminNav active="/admin/resumes" access={guard.access} />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Scope the bundle</h2>
          <p className="text-sm text-muted">
            The zip is generated when you ask for it and never stored — one file per resume, named
            LastName_FirstName_Classification_Major, plus a manifest.csv listing every row.
          </p>
        </div>
        <ResumesFilterBar majors={coreFormConfig.majors} houses={coreFormConfig.houses} />
        <p className="numeric text-sm text-muted">
          {formatNumber(rows.length)} matching · {formatNumber(rows.filter((r) => r.resumeConsentAt).length)} in the
          bundle
        </p>
        <ResumesTable rows={rows} filters={filters} houses={coreFormConfig.houses} totalWithConsent={counts.withConsent} />
      </section>
    </main>
  );
}
