import Link from "next/link";
import Card from "@/components/ui/Card";
import { getMissingFields, type CoreFieldKey } from "@/lib/core-form";
import type { Member } from "@/lib/types";

type PanelMember = Pick<
  Member,
  | "role"
  | "firstName"
  | "lastName"
  | "studentId"
  | "phone"
  | "personalEmail"
  | "classification"
  | "major"
  | "majorOther"
  | "profileSeason"
  | "duesPaidReported"
  | "nationalMemberReported"
  | "membershipSeason"
  | "house"
  | "houseVerifiedAt"
  | "resumeFileId"
>;

/** Where each gap-filler field lives on this page, and what to call it. Deliberately partial — bisonEmail is never a CoreFieldKey, so it can never appear. */
const FIELD_LOCATION: Partial<Record<CoreFieldKey, { anchor: string; label: string }>> = {
  firstName: { anchor: "#profile", label: "Name" },
  lastName: { anchor: "#profile", label: "Name" },
  studentId: { anchor: "#profile", label: "Student ID" },
  phone: { anchor: "#profile", label: "Phone" },
  personalEmail: { anchor: "#profile", label: "Personal email" },
  classification: { anchor: "#profile", label: "Classification" },
  major: { anchor: "#profile", label: "Major" },
  majorOther: { anchor: "#profile", label: "Major" },
  duesPaid: { anchor: "#membership", label: "Chapter dues" },
  nationalMember: { anchor: "#membership", label: "National NSBE membership" },
  house: { anchor: "#house", label: "NSBE House" },
  resume: { anchor: "#resume", label: "Resume" },
};

/**
 * Lists exactly what lib/core-form.ts getMissingFields would ask for at the
 * member's next check-in — the SAME function the check-in form itself calls,
 * so this panel and the form can never drift on "what's missing." A member
 * who clears everything here gets a one-tap check-in at their next event.
 * Renders nothing once the profile is complete for the current season.
 */
export default function CompleteProfilePanel({ member, season }: { member: PanelMember; season: string }) {
  const missing = getMissingFields(member, { audience: "all" }, { SEASON: season });
  if (missing.length === 0) return null;

  const seen = new Set<string>();
  const items = missing
    .map((key) => FIELD_LOCATION[key])
    .filter((item): item is { anchor: string; label: string } => Boolean(item))
    .filter((item) => {
      const dedupeKey = `${item.anchor}:${item.label}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Complete your profile</h2>
      <Card className="border-amber bg-amber/10">
        <p className="text-sm text-ink">Fill these in now so your next check-in is a single tap.</p>
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((item) => (
            <li key={`${item.anchor}-${item.label}`}>
              <Link href={item.anchor} className="text-sm font-medium text-signal underline underline-offset-2">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
