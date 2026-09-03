import { redirect } from "next/navigation";
import AccountSection from "@/components/account/AccountSection";
import CompleteProfilePanel from "@/components/account/CompleteProfilePanel";
import HouseSection from "@/components/account/HouseSection";
import MembershipSection from "@/components/account/MembershipSection";
import ProfileSection from "@/components/account/ProfileSection";
import ResumeSection from "@/components/account/ResumeSection";
import { getConfigValue, getCoreFormUiConfig, getMember } from "@/lib/repo";
import { requireSession } from "@/lib/session";

/**
 * Who you are and what you've submitted — profile data, not activity data.
 * /dashboard owns points/rank/chart/history; this page never duplicates that.
 */
export default async function AccountPage() {
  const session = await requireSession();
  if (session.user.status !== "active") redirect("/pending");

  const [member, season, coreFormConfig] = await Promise.all([
    getMember(session.user.orgId, session.user.email),
    getConfigValue(session.user.orgId, "SEASON", ""),
    getCoreFormUiConfig(session.user.orgId),
  ]);
  if (!member) redirect("/pending");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Account</h1>

      <CompleteProfilePanel member={member} season={season} />

      <ProfileSection member={member} majors={coreFormConfig.majors} />
      <MembershipSection
        member={member}
        season={season}
        membershipSiteUrl={coreFormConfig.membershipSiteUrl}
        nationalMembershipUrl={coreFormConfig.nationalMembershipUrl}
      />
      <HouseSection member={member} houses={coreFormConfig.houses} houseTestUrl={coreFormConfig.houseTestUrl} />
      <ResumeSection member={member} />
      <AccountSection email={member.email} season={season} />
    </main>
  );
}
