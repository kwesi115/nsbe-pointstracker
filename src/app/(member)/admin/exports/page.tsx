import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../_components/AccessDenied";
import { Download } from "lucide-react";
import AdminNav from "@/components/admin/AdminNav";
import CreateSnapshotButton from "@/components/admin/CreateSnapshotButton";
import Card from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";
import { listSeasonSnapshots } from "@/lib/export/snapshot";

const EXPORTS = [
  {
    href: "/api/admin/export/workbook",
    label: "Full season workbook (.xlsx)",
    description:
      "Members, events, registrations, point system, leaderboard, admin log, and one response sheet per event. Password hashes, verification tokens, and join codes are never included.",
  },
  {
    href: "/api/admin/export/leaderboard/csv",
    label: "Leaderboard (.csv)",
    description: "Current standings — rank, name, email, points, and events attended.",
  },
];

export default async function AdminExportsPage() {
  const guard = await guardAdminPage({ level: "eboard", feature: "exports" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const snapshots = await listSeasonSnapshots(session.user.orgId);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Exports</h1>
        <p className="text-sm text-muted">
          Postgres is the source of truth — everything here is generated on demand, not a file anyone edits.
        </p>
      </div>
      <AdminNav active="/admin/exports" access={guard.access} />

      <div className="flex flex-col gap-4">
        {EXPORTS.map((item) => (
          <Card key={item.href} className="flex flex-col gap-3">
            <p className="text-sm text-ink">{item.description}</p>
            <a
              href={item.href}
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-signal px-4 text-sm font-semibold text-white hover:bg-[#2549c4]"
            >
              <Download size={16} aria-hidden="true" /> {item.label}
            </a>
          </Card>
        ))}

        <Card className="flex flex-col gap-2">
          <p className="text-sm text-ink">A single event&apos;s responses (.csv) — from that event&apos;s Responses page.</p>
          <a href="/admin" className="text-sm font-semibold text-signal underline underline-offset-2 w-fit">
            Go to Events
          </a>
        </Card>

        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Season snapshots</p>
            <p className="text-sm text-muted">
              A human-readable full-season backup, stored separately from the nightly database backup — if Postgres is ever
              unrecoverable, this workbook is still a complete record of the season. Created automatically before a bulk
              member import or a category point-value change, or on demand here.
            </p>
          </div>
          <CreateSnapshotButton />
          {snapshots.length > 0 ? (
            <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
              {snapshots.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink">{s.createdAt ? formatDateTime(new Date(s.createdAt)) : s.filename}</span>
                  <a
                    href={`/api/admin/export/snapshot/${s.key.split("/").map(encodeURIComponent).join("/")}`}
                    className="inline-flex items-center gap-1 font-semibold text-signal underline underline-offset-2"
                  >
                    <Download size={14} aria-hidden="true" /> Download
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No snapshots yet.</p>
          )}
        </Card>
      </div>
    </main>
  );
}
