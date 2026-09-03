import { notFound } from "next/navigation";
import ProjectorClient from "@/components/admin/ProjectorClient";
import { currentCode, msUntilRotation } from "@/lib/code";
import { isOpen } from "@/lib/points";
import { eventsQrSvg } from "@/lib/qr";
import { getEventCodeAlertState } from "@/lib/rate-limit";
import { getAttendanceForEvent, getEvent } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

export default async function EventDisplayPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireEboard();
  const { id } = await params;
  const event = await getEvent(session.user.orgId, id);
  if (!event) notFound();

  const now = new Date();
  const open = isOpen(event, now);
  const [attendance, qrSvg] = await Promise.all([getAttendanceForEvent(session.user.orgId, id), eventsQrSvg()]);

  return (
    <ProjectorClient
      eventId={id}
      qrSvg={qrSvg}
      initial={{
        name: event.name,
        open,
        registrationCount: attendance.length,
        closesAt: event.closesAt ? event.closesAt.toISOString() : null,
        code: open ? currentCode(event.eventId, now) : null,
        msUntilRotation: open ? msUntilRotation(now) : null,
        codeAlert: getEventCodeAlertState(id),
      }}
    />
  );
}
