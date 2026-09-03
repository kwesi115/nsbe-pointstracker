import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Events" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/verifications", label: "Membership audit" },
  { href: "/admin/leaderboard", label: "E-Board leaderboard" },
  { href: "/admin/attendance", label: "Attendance" },
  { href: "/admin/groups", label: "NSBE Week groups" },
  { href: "/admin/awards", label: "Bonus awards" },
  { href: "/admin/exports", label: "Exports" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/qr", label: "QR code" },
  { href: "/admin/join-codes", label: "Join codes" },
] as const;

/**
 * Cross-nav for every /admin/* page. No verification-count badge — the
 * membership audit queue is a spot-check, not a blocking gate (see
 * /admin/verifications), and a permanent red badge trains people to ignore
 * it.
 */
export default function AdminNav({ active }: { active: (typeof LINKS)[number]["href"] }) {
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-1">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`flex items-center gap-1.5 text-sm underline-offset-2 hover:text-ink ${
            link.href === active ? "font-semibold text-ink underline" : "text-muted underline"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
