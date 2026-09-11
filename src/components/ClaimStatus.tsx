import { Check, Hand, X } from "lucide-react";
import { EmptyValue } from "@/components/StatusIcon";
import { CLAIM_STATE_LABEL, type ClaimState } from "@/lib/claim-state";
import { formatDate } from "@/lib/format";

/**
 * The ONE way a dues/national claim is drawn, anywhere in the app.
 *
 * The bug this replaces was a self-reported claim rendering the SAME green
 * check as a verified one, so an admin looking at the roster could not tell
 * what had actually been checked. Four states, four distinct glyphs:
 *
 *   none      grey dash — the member never claimed it
 *   pending   amber hand ("self-reported") — the member's word, nothing more
 *   verified  green check — an admin confirmed it, with who and when
 *   revoked   red cross — an admin determined it was false, with the note
 *
 * A check mark means verified and nothing else. If you are tempted to render
 * one from a *Reported flag, you are re-introducing the bug.
 *
 * Deliberately NOT StatusIcon: that component maps a boolean|null onto
 * yes/no/pending, which is exactly the three-state shape that can't express
 * "the member said yes and nobody has checked." It still serves the Eligible
 * and Resume columns, where a boolean really is the whole truth.
 */
export default function ClaimStatus({
  state,
  verifiedAt,
  verifiedByName,
  revokedNote,
  claimLabel,
}: {
  state: ClaimState;
  verifiedAt?: Date | null;
  verifiedByName?: string;
  revokedNote?: string;
  /** "Dues" / "National membership" — makes the screen-reader label say what was claimed, not just its state. */
  claimLabel: string;
}) {
  if (state === "none") return <EmptyValue label={`${claimLabel}: not reported`} />;

  // `title` on the wrapper is the sighted hover detail; aria-label on the
  // glyph carries the same words for a screen reader (a bare check conveys
  // nothing either way).
  if (state === "verified") {
    const by = verifiedByName ? ` by ${verifiedByName}` : "";
    const on = verifiedAt ? ` on ${formatDate(verifiedAt)}` : "";
    return (
      <span title={`Verified${by}${on}`} className="inline-flex">
        <Check size={16} className="text-signal" aria-label={`${claimLabel}: verified${by}${on}`} />
      </span>
    );
  }

  if (state === "revoked") {
    return (
      <span title={revokedNote ? `Revoked — ${revokedNote}` : "Revoked"} className="inline-flex">
        <X size={16} className="text-alert" aria-label={`${claimLabel}: revoked${revokedNote ? ` — ${revokedNote}` : ""}`} />
      </span>
    );
  }

  return (
    <span title="Self-reported — not yet verified" className="inline-flex">
      <Hand size={16} className="text-[#7a4d00]" aria-label={`${claimLabel}: self-reported, not yet verified`} />
    </span>
  );
}

/** Text form of the same four states, for places with room for a word rather than a glyph. */
export function claimStateLabel(state: ClaimState): string {
  return CLAIM_STATE_LABEL[state];
}
