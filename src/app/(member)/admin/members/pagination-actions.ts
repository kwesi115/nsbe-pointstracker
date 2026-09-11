"use server";

import { requireAdmin } from "@/lib/session";
import { getMembersPage, type MemberFilters, type MembersPage } from "@/lib/repo";

/**
 * The next page of the roster, for MembersTable's "Show more".
 *
 * The filters travel WITH the request rather than being applied to something
 * the client already holds — page two of a search has to be page two of that
 * search across the whole roster, not the next slice of a preloaded array.
 */
export async function loadMembersPageAction(
  filters: MemberFilters,
  cursor: string | null,
): Promise<{ page: MembersPage | null; error: string | null }> {
  const session = await requireAdmin();
  const page = await getMembersPage(session.user.orgId, filters, { cursor });
  return { page, error: null };
}
