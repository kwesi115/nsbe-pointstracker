/**
 * Pure wizard rules with no side effects, split out of JoinWizard.tsx so they
 * can be unit-tested without pulling in the client component's imports
 * (server actions, Prisma) — this repo's vitest config runs in the "node"
 * environment with no DOM, so JoinWizard.tsx itself isn't render-tested.
 */

import { houseSelfVerifies } from "@/lib/core-form";
import type { Role } from "@/lib/types";

/**
 * The step list moved to lib/signup.ts, because the resume flow's server-side
 * guards need it too and `lib` must not import from `components`. Re-exported
 * here so the wizard's own imports keep reading naturally — there is still
 * exactly one implementation.
 */
export { stepsFor, type AccountType, type StepKey } from "@/lib/signup";

const SELECT_OR_SKIP = `Select your House, or choose "I haven't taken the test yet."`;

export interface HouseAnswer {
  houseSkipped: boolean;
  house: string;
  houseProofFileId: string | undefined;
}

/**
 * Gate for the House step's Continue button — no Yes/No question anymore
 * (Part 1 restructure). Skipping ("I haven't taken the test yet") is a
 * complete, valid answer on its own, for every role. Otherwise a House and
 * its screenshot are required TOGETHER — one without the other is unusable
 * — except for a role that self-verifies (see lib/core-form.ts
 * houseSelfVerifies), where the House alone IS the complete answer and there
 * is no upload control rendered to satisfy. Mirrors setHouseAssignment's
 * server-side check — this is a UX affordance, not the rule itself; the
 * server re-validates independently off the roster role.
 */
export function validateHouseStep(answer: HouseAnswer, role: Role): string | null {
  if (answer.houseSkipped) return null;
  if (houseSelfVerifies(role)) {
    return answer.house ? null : SELECT_OR_SKIP;
  }
  if (!answer.house && !answer.houseProofFileId) {
    return 'Select your House and upload your screenshot, or choose "I haven\'t taken the test yet."';
  }
  if (!answer.house) return "Select your House.";
  if (!answer.houseProofFileId) return "Upload your House test result.";
  return null;
}
