/**
 * Pure wizard rules with no side effects, split out of JoinWizard.tsx so they
 * can be unit-tested without pulling in the client component's imports
 * (server actions, Prisma) — this repo's vitest config runs in the "node"
 * environment with no DOM, so JoinWizard.tsx itself isn't render-tested.
 */

import type { Role } from "@/lib/types";

export type StepKey = "type" | "code" | "account" | "about" | "contact" | "membership" | "house" | "resume";

export type AccountType = "general" | "eboard" | "admin" | null;

/**
 * `accountType` is the step-1 picker's client-side hint — it only decides
 * whether the "code" step is shown at all (a General signup needs no code,
 * so it goes straight from the picker to the account step). `resolvedRole`
 * is the server-confirmed role from the redeemed code (or "general" itself,
 * for a codeless signup) — it's what decides whether Membership/House/Resume
 * are skipped. The two are deliberately separate: the picker is never
 * authorization, only UI routing (see JoinWizard.tsx's JoinCodeStep copy).
 */
export function stepsFor(accountType: AccountType, resolvedRole: Role | null): StepKey[] {
  const base: StepKey[] = ["type"];
  if (accountType !== "general") base.push("code");
  base.push("account", "about", "contact");
  if (resolvedRole === "eboard" || resolvedRole === "admin") return base;
  return [...base, "membership", "house", "resume"];
}

export interface HouseAnswer {
  houseSkipped: boolean;
  house: string;
  houseProofFileId: string | undefined;
}

/**
 * Gate for the House step's Continue button — no Yes/No question anymore
 * (Part 1 restructure). Skipping ("I haven't taken the test yet") is a
 * complete, valid answer on its own; otherwise a House and its screenshot
 * are required TOGETHER — one without the other is unusable. Mirrors
 * setHouseAction's server-side check in join/actions.ts — this is a UX
 * affordance, not the rule itself; the server re-validates independently.
 */
export function validateHouseStep(answer: HouseAnswer): string | null {
  if (answer.houseSkipped) return null;
  if (!answer.house && !answer.houseProofFileId) {
    return 'Select your House and upload your screenshot, or choose "I haven\'t taken the test yet."';
  }
  if (!answer.house) return "Select your House.";
  if (!answer.houseProofFileId) return "Upload your House test result.";
  return null;
}
