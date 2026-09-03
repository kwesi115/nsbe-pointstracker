/**
 * Unit tests for the join wizard's pure rules (joinWizardRules.ts) — kept
 * separate from JoinWizard.tsx's own server-action/Prisma import chain so
 * the "can't advance without an answer" rule is testable in this repo's
 * "node" vitest environment (see vitest.config.ts) without a DOM-rendering
 * harness.
 */

import { describe, expect, it } from "vitest";
import { stepsFor, validateHouseStep } from "./joinWizardRules";

describe("validateHouseStep — no Yes/No question; House+screenshot together, or an explicit skip", () => {
  it("blocks a House selection with no screenshot", () => {
    expect(
      validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: undefined }),
    ).toBeTruthy();
  });

  it("blocks a screenshot with no House selection", () => {
    expect(validateHouseStep({ houseSkipped: false, house: "", houseProofFileId: "file_1" })).toBeTruthy();
  });

  it("blocks neither House nor screenshot when not skipped", () => {
    expect(validateHouseStep({ houseSkipped: false, house: "", houseProofFileId: undefined })).toBeTruthy();
  });

  it("allows a House once both a House and a screenshot are present", () => {
    expect(
      validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: "file_1" }),
    ).toBeNull();
  });

  it("allows an explicit skip on its own — it's a complete, valid answer, even with stray partial fields", () => {
    expect(validateHouseStep({ houseSkipped: true, house: "", houseProofFileId: undefined })).toBeNull();
    expect(validateHouseStep({ houseSkipped: true, house: "House Turing", houseProofFileId: "file_1" })).toBeNull();
  });
});

describe("stepsFor — General needs no code step; EBOARD/ADMIN still skip Membership/House/Resume", () => {
  it("picking General drops the code step entirely — straight from the picker to the account step", () => {
    const steps = stepsFor("general", "general");
    expect(steps).not.toContain("code");
    expect(steps).toContain("house");
    expect(steps).toContain("resume");
    expect(steps.indexOf("house")).toBeLessThan(steps.indexOf("resume"));
  });

  it("before any pick is made, the code step is still present (the default, not-yet-general state)", () => {
    const steps = stepsFor(null, null);
    expect(steps).toContain("code");
  });

  it("picking EBOARD or ADMIN keeps the code step", () => {
    expect(stepsFor("eboard", null)).toContain("code");
    expect(stepsFor("admin", null)).toContain("code");
  });

  it("EBOARD signup (once the code resolves) skips Membership, House, and Resume", () => {
    const steps = stepsFor("eboard", "eboard");
    expect(steps).toContain("code");
    expect(steps).not.toContain("membership");
    expect(steps).not.toContain("house");
    expect(steps).not.toContain("resume");
  });

  it("ADMIN signup (once the code resolves) skips Membership, House, and Resume", () => {
    const steps = stepsFor("admin", "admin");
    expect(steps).toContain("code");
    expect(steps).not.toContain("membership");
    expect(steps).not.toContain("house");
    expect(steps).not.toContain("resume");
  });

  it("a downgrade — picked EBOARD/ADMIN but the code only granted GENERAL — falls through to the full General step list", () => {
    const steps = stepsFor("eboard", "general");
    expect(steps).toContain("code");
    expect(steps).toContain("membership");
    expect(steps).toContain("house");
    expect(steps).toContain("resume");
  });

  it("Resume is always the last step when present, and has no equivalent gate — it stays skippable via 'Do this later'", () => {
    const steps = stepsFor("general", "general");
    expect(steps[steps.length - 1]).toBe("resume");
  });
});
