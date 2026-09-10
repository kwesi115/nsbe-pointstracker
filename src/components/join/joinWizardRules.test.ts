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

describe("stepsFor — General needs no code step; only ADMIN skips any profile step", () => {
  const GENERAL_STEPS = stepsFor("general", "general");
  const EBOARD_STEPS = stepsFor("eboard", "eboard");
  const ADMIN_STEPS = stepsFor("admin", "admin");

  it("picking General drops the code step entirely — straight from the picker to the account step", () => {
    expect(GENERAL_STEPS).not.toContain("code");
    expect(GENERAL_STEPS).toContain("house");
    expect(GENERAL_STEPS).toContain("resume");
    expect(GENERAL_STEPS.indexOf("house")).toBeLessThan(GENERAL_STEPS.indexOf("resume"));
  });

  it("before any pick is made, the code step is still present (the default, not-yet-general state)", () => {
    const steps = stepsFor(null, null);
    expect(steps).toContain("code");
  });

  it("picking EBOARD or ADMIN keeps the code step", () => {
    expect(stepsFor("eboard", null)).toContain("code");
    expect(stepsFor("admin", null)).toContain("code");
  });

  it("an EBOARD signup renders every step a GENERAL signup renders — the join code step is the ONLY difference", () => {
    expect(EBOARD_STEPS).toEqual(["type", "code", ...GENERAL_STEPS.slice(1)]);
    expect(EBOARD_STEPS).toContain("code");
    expect(GENERAL_STEPS).not.toContain("code");
  });

  it("an EBOARD signup cannot skip About you, Contact, Membership, House, or Resume", () => {
    for (const step of ["about", "contact", "membership", "house", "resume"] as const) {
      expect(EBOARD_STEPS).toContain(step);
    }
  });

  it("the House step is mandatory for EBOARD — validateHouseStep still gates it, skip still valid", () => {
    expect(EBOARD_STEPS).toContain("house");
    expect(validateHouseStep({ houseSkipped: false, house: "", houseProofFileId: undefined })).toBeTruthy();
    expect(validateHouseStep({ houseSkipped: true, house: "", houseProofFileId: undefined })).toBeNull();
  });

  it("an ADMIN signup skips about-you, contact, membership, House, and resume", () => {
    expect(ADMIN_STEPS).toEqual(["type", "code", "account"]);
    for (const step of ["about", "contact", "membership", "house", "resume"] as const) {
      expect(ADMIN_STEPS).not.toContain(step);
    }
  });

  it("a downgrade — picked EBOARD/ADMIN but the code only granted GENERAL — falls through to the full General step list", () => {
    for (const picked of ["eboard", "admin"] as const) {
      const steps = stepsFor(picked, "general");
      expect(steps).toEqual(["type", "code", ...GENERAL_STEPS.slice(1)]);
    }
  });

  it("Resume is always the last step when present, and has no equivalent gate — it stays skippable via 'Do this later'", () => {
    expect(GENERAL_STEPS[GENERAL_STEPS.length - 1]).toBe("resume");
    expect(EBOARD_STEPS[EBOARD_STEPS.length - 1]).toBe("resume");
  });
});
