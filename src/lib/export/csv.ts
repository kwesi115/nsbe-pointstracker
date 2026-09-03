import { AppError } from "@/lib/errors";
import { toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import {
  DEFAULT_LEADERBOARD_DISCLAIMER,
  getConfigValue,
  getEboardBoardRows,
  getEvent,
  getEventResponses,
  getFormFields,
  getMembersWithStats,
  getStandings,
} from "@/lib/repo";

export async function buildEventResponsesCsv(orgId: string, eventId: string): Promise<{ csv: string; filename: string }> {
  const event = await getEvent(orgId, eventId);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");
  const [fields, responses] = await Promise.all([getFormFields(orgId, eventId), getEventResponses(orgId, eventId)]);
  const fieldKeys = fields.map((f) => f.fieldKey);

  const header = ["Name", "Email", "Timestamp", "Points", ...fields.map((f) => f.label || f.fieldKey)];
  const rows = responses.map((r) => [
    `${r.firstName} ${r.lastName}`.trim(),
    r.email,
    formatDateTime(r.timestamp),
    String(r.pointsAwarded),
    ...fieldKeys.map((k) => r.answers[k] ?? ""),
  ]);

  return { csv: toCsv([header, ...rows]), filename: `${event.slug}-responses.csv` };
}

export async function buildLeaderboardCsv(orgId: string): Promise<{ csv: string; filename: string }> {
  const [standings, disclaimer] = await Promise.all([
    getStandings(orgId),
    getConfigValue(orgId, "LEADERBOARD_DISCLAIMER", DEFAULT_LEADERBOARD_DISCLAIMER),
  ]);
  const header = ["Rank", "First Name", "Last Name", "Email", "Points", "Events"];
  const rows = standings.map((s) => [String(s.rank), s.firstName, s.lastName, s.email, String(s.points), String(s.events)]);
  const stamp = new Date().toISOString().slice(0, 10);
  return { csv: toCsv([[disclaimer], header, ...rows]), filename: `leaderboard-${stamp}.csv` };
}

/** EBOARD-or-above only, same as the member leaderboard export — see /admin/leaderboard. */
export async function buildEboardLeaderboardCsv(orgId: string): Promise<{ csv: string; filename: string }> {
  const rows = await getEboardBoardRows(orgId);
  const header = [
    "Rank",
    "First Name",
    "Last Name",
    "Email",
    "Position",
    "Total Points",
    "Total Events",
    "Chapter Points",
    "Chapter Attended",
    "Chapter Eligible",
    "E-Board Meeting Points",
    "E-Board Meeting Attended",
    "E-Board Meeting Eligible",
    "Retreat Points",
    "Retreat Attended",
    "Retreat Eligible",
  ];
  const csvRows = rows.map((r) => [
    String(r.rank),
    r.firstName,
    r.lastName,
    r.email,
    r.eboardPosition,
    String(r.points),
    String(r.events),
    String(r.chapter.points),
    String(r.chapter.attended),
    String(r.chapter.eligible),
    String(r.eboardMeetings.points),
    String(r.eboardMeetings.attended),
    String(r.eboardMeetings.eligible),
    String(r.retreats.points),
    String(r.retreats.attended),
    String(r.retreats.eligible),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  return { csv: toCsv([header, ...csvRows]), filename: `eboard-leaderboard-${stamp}.csv` };
}

/** Admin-only — /admin/members "Export selected" (Part 5). Selection is a list of emails, since it can exceed a GET URL's practical length. */
export async function buildMembersCsv(orgId: string, emails: string[]): Promise<{ csv: string; filename: string }> {
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()));
  const members = (await getMembersWithStats(orgId)).filter((m) => wanted.has(m.email));
  const header = [
    "First Name",
    "Last Name",
    "Email",
    "Classification",
    "Major",
    "Dues",
    "National",
    "Eligible",
    "House",
    "Resume",
    "Role",
    "Points",
    "Events",
  ];
  const rows = members.map((m) => [
    m.firstName,
    m.lastName,
    m.email,
    m.classification,
    m.major,
    m.duesPaidReported === true ? "Reported" : "Not reported",
    m.nationalMemberReported === true ? "Reported" : "Not reported",
    m.eligible ? "Yes" : "No",
    m.houseState,
    m.resumeFileId ? "On file" : "None",
    m.role,
    String(m.points),
    String(m.events),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  return { csv: toCsv([header, ...rows]), filename: `members-${stamp}.csv` };
}
