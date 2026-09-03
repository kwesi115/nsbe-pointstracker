import Badge, { type BadgeTone } from "@/components/ui/Badge";
import type { AccountState } from "@/lib/types";

const LABEL: Record<AccountState, string> = {
  active: "Active",
  setup_pending: "Setup pending",
  reset_pending: "Reset pending",
};

const TONE: Record<AccountState, BadgeTone> = {
  active: "signal",
  setup_pending: "amber",
  reset_pending: "amber",
};

export default function AccountStateBadge({ state }: { state: AccountState }) {
  return <Badge tone={TONE[state]}>{LABEL[state]}</Badge>;
}
