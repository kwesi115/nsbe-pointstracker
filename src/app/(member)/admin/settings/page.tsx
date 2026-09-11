import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../_components/AccessDenied";
import { KeyRound, Layers } from "lucide-react";
import Link from "next/link";
import AdminNav from "@/components/admin/AdminNav";
import CoreFormSettingsForm from "@/components/admin/CoreFormSettingsForm";
import EboardSettingsForm from "@/components/admin/EboardSettingsForm";
import ExportsSettingsForm from "@/components/admin/ExportsSettingsForm";
import ExternalLinksForm from "@/components/admin/ExternalLinksForm";
import SettingsForm from "@/components/admin/SettingsForm";
import Card from "@/components/ui/Card";
import { DEFAULT_LEADERBOARD_DISCLAIMER, DEFAULT_NATIONAL_MEMBERSHIP_URL, getConfigValue, getCoreFormConfig } from "@/lib/repo";

export default async function AdminSettingsPage() {
  const guard = await guardAdminPage({ level: "admin" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const orgId = session.user.orgId;

  const [
    chapterName,
    season,
    domain,
    adminEmailAllowlist,
    defaultEventDuration,
    leaderboardDisclaimer,
    coreFormConfig,
    houseTestUrl,
    membershipSiteUrl,
    nationalMembershipUrl,
    showPendingPoints,
    maxExtraQuestions,
    eboardPointValue,
    eboardTrackEnabled,
    eboardRequiresMembership,
  ] = await Promise.all([
    getConfigValue(orgId, "CHAPTER_NAME", "NSBE"),
    getConfigValue(orgId, "SEASON", ""),
    getConfigValue(orgId, "ALLOWED_EMAIL_DOMAIN", ""),
    getConfigValue(orgId, "ADMIN_EMAIL_ALLOWLIST", ""),
    getConfigValue(orgId, "DEFAULT_EVENT_DURATION", "20"),
    getConfigValue(orgId, "LEADERBOARD_DISCLAIMER", DEFAULT_LEADERBOARD_DISCLAIMER),
    getCoreFormConfig(orgId),
    getConfigValue(orgId, "HOUSE_TEST_URL", ""),
    getConfigValue(orgId, "MEMBERSHIP_SITE_URL", ""),
    getConfigValue(orgId, "NATIONAL_MEMBERSHIP_URL", DEFAULT_NATIONAL_MEMBERSHIP_URL),
    getConfigValue(orgId, "SHOW_PENDING_POINTS", "false"),
    getConfigValue(orgId, "MAX_EXTRA_QUESTIONS", "5"),
    getConfigValue(orgId, "EBOARD_POINT_VALUE", "1"),
    getConfigValue(orgId, "EBOARD_TRACK_ENABLED", "true"),
    getConfigValue(orgId, "EBOARD_REQUIRES_MEMBERSHIP", "false"),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Settings</h1>
      <AdminNav active="/admin/settings" access={guard.access} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Join codes</h2>
        <Card>
          <Link
            href="/admin/join-codes"
            className="flex items-center gap-3 text-sm font-semibold text-ink hover:text-signal"
          >
            <KeyRound size={18} aria-hidden="true" />
            Manage role-scoped join codes
          </Link>
          <p className="mt-1 text-sm text-muted">
            Create, rotate, and deactivate the General/E-Board/Admin/Guest codes members and guests use to join.
          </p>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Event categories &amp; scoring</h2>
        <Card>
          <Link
            href="/admin/settings/categories"
            className="flex items-center gap-3 text-sm font-semibold text-ink hover:text-signal"
          >
            <Layers size={18} aria-hidden="true" />
            Manage event categories, tiers &amp; point values
          </Link>
          <p className="mt-1 text-sm text-muted">
            Replaces the old flat point system. Also see{" "}
            <Link href="/admin/groups" className="underline underline-offset-2 hover:text-ink">
              NSBE Week groups
            </Link>{" "}
            and{" "}
            <Link href="/admin/awards" className="underline underline-offset-2 hover:text-ink">
              bonus awards
            </Link>
            .
          </p>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">General</h2>
        <Card>
          <SettingsForm
            chapterName={chapterName}
            season={season}
            domain={domain}
            adminEmailAllowlist={adminEmailAllowlist}
            defaultEventDuration={defaultEventDuration}
            leaderboardDisclaimer={leaderboardDisclaimer}
          />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Check-in form &amp; eligibility</h2>
        <Card>
          <CoreFormSettingsForm
            majorsList={coreFormConfig.majors.join("|")}
            houses={coreFormConfig.houses}
            showPendingPoints={showPendingPoints === "true"}
            maxExtraQuestions={maxExtraQuestions}
          />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">External links</h2>
        <Card>
          <ExternalLinksForm
            houseTestUrl={houseTestUrl}
            membershipSiteUrl={membershipSiteUrl}
            nationalMembershipUrl={nationalMembershipUrl}
          />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Exports</h2>
        <Card>
          <ExportsSettingsForm exportsEnabled={guard.access.features.exports} />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">E-Board track</h2>
        <Card>
          <EboardSettingsForm
            eboardPointValue={eboardPointValue}
            eboardTrackEnabled={eboardTrackEnabled === "true"}
            eboardRequiresMembership={eboardRequiresMembership === "true"}
          />
        </Card>
      </section>
    </main>
  );
}
