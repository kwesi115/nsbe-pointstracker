# Claim state and the House requirement

Two decisions that were previously implicit, spread across several files, and
got them wrong in different places. Both are now single-sourced in code; this
file records *why*.

## 1. A claim has four states, not two

`src/lib/claim-state.ts` `claimState(reported, verifiedAt, revokedAt)` is the
only function allowed to interpret the `dues*` / `national*` column group:

| state      | meaning                                        | glyph |
| ---------- | ---------------------------------------------- | ----- |
| `none`     | the member never claimed it                    | grey dash |
| `pending`  | the member said yes, nobody has checked         | amber hand, "self-reported" |
| `verified` | an admin confirmed it, with who and when        | green check |
| `revoked`  | an admin determined it was false, with the note | red cross |

**A self-reported claim must never render the same glyph as a verified one.**
That is the whole rule. `src/components/ClaimStatus.tsx` is the only component
that draws a claim; if you are about to render a check mark from a `*Reported`
flag, stop.

`StatusIcon` still serves the Eligible and Resume columns, where a boolean
really is the whole truth. It cannot express "said yes, unchecked", which is
why it was the wrong component for Dues and National.

### Eligibility is unrelated

Leaderboard eligibility is driven by the **reported** flags and the season, and
by nothing else — see `lib/points.ts isEligible`. Verification is an audit
layer on top. A `pending` claim counts for standings exactly like a `verified`
one, deliberately: members land on the board the moment they report, without
waiting on E-Board. Nothing in `claim-state.ts` may ever be wired into
`isEligible`; `points.test.ts` asserts this.

### Invariants the writers maintain

- `verified` and `revoked` are mutually exclusive: `verifyDues` clears the
  revoke stamps, `revokeDues` clears the verify stamp.
- Every verify records **who**: `duesVerifiedById` / `nationalVerifiedById` /
  `houseVerifiedById`. A verified row with no verifier is unauditable —
  "verified by whom?" must have an answer.
- **Re-reporting clears a previous revoke.** A fresh "yes" is a new claim, so
  the old adjudication does not apply to it. Without this the row keeps
  `duesRevokedAt` while `duesPaidReported` is true again: `claimState` reads
  "revoked", the pending-only audit queue never surfaces it, and the member
  sits on the leaderboard with a claim no admin can reach. Both write sites
  do this (`setDuesReported` and `registerForEvent`'s inline write).

### The audit queue filters on state, and nothing else

`getDuesPendingMembers` / `getNationalPendingMembers` / `getHousePendingMembers`
carry no role filter. They used to filter `role: GENERAL`, which hid every
E-Board claim — on the Howard roster, 31 of 34 outstanding dues claims. An
officer pays chapter dues and holds a national membership like anyone else; a
claim is audited on its state, never on who made it.

Every tab renders its count, including zero, so "nothing pending" and "the
query is filtering everything out" can never look alike again.

## 2. House: option (b) — ACTIVE account, demanded by the gap filler

The account is marked ACTIVE at wizard step 3 and stays ACTIVE even if the
member never reaches the House step (step 7). House is then demanded by
`getMissingFields`, which surfaces it at the member's next check-in on an
ALL-audience event and on `/account`'s "Complete your profile" panel.

Chosen over (a) "not ACTIVE until the wizard completes" because:

- It matches the existing gap-filler design, which is how every other
  late-arriving field (classification, major, resume, dues) is already
  collected. (a) would add a second, parallel notion of completeness.
- An account that isn't ACTIVE can't sign in, so a member who closed the tab
  at step 7 would be locked out of the account they just made — and the House
  test lives on an external site, so "come back later" is a normal path, not
  an edge case.

**The House step must be ANSWERED, server-side.** `setHouseAction` requires an
explicit `houseSkipped` boolean. It used to treat "no fields at all" as a skip,
so any POST that simply omitted the House answer completed the step. Now:

- `houseSkipped: true` — "I haven't taken the test yet". Valid, writes nothing,
  and `getMissingFields` keeps asking.
- `houseSkipped: false` with a House **and** its screenshot (or a House alone
  for a role that self-verifies) — valid, writes the House.
- Anything else — rejected.

Note what (b) does *not* fix on its own: an account is only re-prompted where
the gap filler runs. EBOARD_ONLY events use the reduced core form and ask
nothing, so an officer who only ever attends E-Board meetings is never asked
for a House at check-in. That is deliberate (an officer re-answering the full
form at every weekly meeting is how a form gets abandoned) — which is why the
House-less accounts also need to be **findable**:

- `/admin/members?house=missing` — the roster's House filter is now
  verified / awaiting review / missing, three states rather than a yes/no that
  folded "missing" in with "pending".
- `/admin/verifications` shows a banner counting accounts with no House, since
  the House tab can only ever show Houses that were actually submitted.

ADMIN accounts are excluded from both: they never get a House step
(`joinWizardRules.ts stepsFor`) and `getMissingFields` never asks them for one,
so listing them would be noise, not a gap.

## Repairing bad data

`scripts/repair-claim-state.ts` reports by default and writes only with
`--confirm`. Take a snapshot first (`npm run backup`).

It will **not** verify anything retroactively, **not** clear a self-reported
flag (that would silently drop someone off the leaderboard), and **not** guess
a missing verifier — a `*VerifiedAt` with no `*VerifiedById` is reported for a
human to decide. The one thing it repairs is a stale revoke stamp on a
re-reported claim, which the writers above no longer produce.
