import Badge, { type BadgeTone } from "@/components/ui/Badge";
import type { UserStatus } from "@/lib/types";

const LABEL: Record<UserStatus, string> = { pending: "Pending", active: "Active", suspended: "Suspended" };
const TONE: Record<UserStatus, BadgeTone> = { pending: "amber", active: "signal", suspended: "alert" };

export default function StatusBadge({ status }: { status: UserStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
