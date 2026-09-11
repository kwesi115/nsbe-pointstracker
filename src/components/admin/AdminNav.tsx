import type { AdminAccess, AdminHref } from "@/lib/access";
import { visibleAdminNav } from "@/lib/access";
import AdminNavClient from "./AdminNavClient";

/**
 * Cross-nav for every /admin/* page, rendered per-caller.
 *
 * This used to be a flat eleven-item list shown to everyone, which is what let
 * an EBOARD officer click straight into an ADMIN-only page and get an error —
 * the nav was advertising surfaces the guards would refuse. It now renders
 * only what lib/access.ts says this caller can actually reach, from the same
 * ADMIN_SURFACES table the page guards check, so the two cannot drift apart.
 *
 * `access` is passed in rather than loaded here: the page has already built it
 * via guardAdminPage(), and re-deriving it would mean a second round of role,
 * grant, and feature-flag reads on every admin page render.
 */
export default function AdminNav({ active, access }: { active: AdminHref; access: AdminAccess }) {
  return <AdminNavClient links={visibleAdminNav(access)} active={active} />;
}
