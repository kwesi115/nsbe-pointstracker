/**
 * Unit tests for the join wizard's pure rules (joinWizardRules.ts) — kept
 * separate from JoinWizard.tsx's own server-action/Prisma import chain so
 * the "can't advance without an answer" rule is testable in this repo's
 * "node" vitest environment (see vitest.config.ts) without a DOM-rendering
 * harness.
 */

import { describe, expect, it } from "vitest";
import { stepsFor, validateHouseStep } from "./joinWizardRules";

describe("validateHouseStep — GENERAL needs House+screenshot together, or an explicit skip", () => {
  it("blocks a House selection with no screenshot", () => {
    expect(
      validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: undefined }, "general"),
    ).toBeTruthy();
  });

  it("blocks a screenshot with no House selection", () => {
    expect(validateHouseStep({ houseSkipped: false, house: "", houseProofFileId: "file_1" }, "general")).toBeTruthy();
  });

  it("blocks neither House nor screenshot when not skipped", () => {
    expect(validateHouseStep({ houseSkipped: false, house: "", houseProofFileId: undefined }, "general")).toBeTruthy();
  });

  it("allows a House once both a House and a screenshot are present", () => {
    expect(
      validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: "file_1" }, "general"),
    ).toBeNull();
  });

  it("allows an explicit skip on its own — it's a complete, valid answer, even with stray partial fields", () => {
    expect(validateHouseStep({ houseSkipped: true, house: "", houseProofFileId: undefined }, "general")).toBeNull();
    expect(
      validateHouseStep({ houseSkipped: true, house: "House Turing", houseProofFileId: "file_1" }, "general"),
    ).toBeNull();
  });
});

describe("validateHouseStep — EBOARD selects a House with no upload", () => {
  it("a House alone is a complete answer — no screenshot required", () => {
    expect(
      validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: undefined }, "eboard"),
    ).toBeNull();
  });

  it("the step is still mandatory — neither a House nor a skip is not a way through", () => {
    expect(validateHouseStep({ houseSkipped: false, house: "", houseProofFileId: undefined }, "eboard")).toBeTruthy();
  });

  it("the skip still works — a new officer who hasn't taken the test gets asked again at check-in", () => {
    expect(validateHouseStep({ houseSkipped: true, house: "", houseProofFileId: undefined }, "eboard")).toBeNull();
  });

  it("ADMIN is not exempt from the upload — only EBOARD is, and ADMIN never reaches this step anyway", () => {
    expect(
      validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: undefined }, "admin"),
    ).toBeTruthy();
  });
});

describe("stepsFor — General needs no code step; EBOARD skips House; ADMIN skips every profile step", () => {
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

  it("an EBOARD signup differs from a GENERAL one by exactly two steps: it gains the code step and loses House", () => {
    expect(EBOARD_STEPS).toEqual(["type", "code", "account", "about", "contact", "membership", "resume"]);
    expect(EBOARD_STEPS).toContain("code");
    expect(GENERAL_STEPS).not.toContain("code");
    // Every General step except House, in the same order.
    expect(EBOARD_STEPS.filter((s) => s !== "code")).toEqual(GENERAL_STEPS.filter((s) => s !== "house"));
  });

  it("an EBOARD signup never shows the House step", () => {
    expect(EBOARD_STEPS).not.toContain("house");
  });

  it("an EBOARD signup still cannot skip About you, Contact, Membership, or Resume", () => {
    for (const step of ["about", "contact", "membership", "resume"] as const) {
      expect(EBOARD_STEPS).toContain(step);
    }
  });

  it("a GENERAL signup still requires House, with a House or the explicit skip — and no screenshot escape", () => {
    expect(GENERAL_STEPS).toContain("house");
    // Neither answer given: refused.
    expect(validateHouseStep({ houseSkipped: false, house: "", houseProofFileId: undefined }, "general")).toBeTruthy();
    // The explicit "haven't taken it yet" is a complete answer.
    expect(validateHouseStep({ houseSkipped: true, house: "", houseProofFileId: undefined }, "general")).toBeNull();
    // A House WITHOUT the screenshot is not enough for a General member.
    expect(
      validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: undefined }, "general"),
    ).toBeTruthy();
    // House plus screenshot gets them through.
    expect(
      validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: "file_1" }, "general"),
    ).toBeNull();
  });

  /**
   * validateHouseStep still answers for "eboard" because /account keeps House as
   * an optional field for an officer who wants it on record (and
   * houseSelfVerifies means no screenshot is asked of them there). It is simply
   * no longer reachable from the signup wizard.
   */
  it("the eboard House rule survives for /account, where the field is still offered", () => {
    expect(validateHouseStep({ houseSkipped: false, house: "House Turing", houseProofFileId: undefined }, "eboard")).toBeNull();
  });

  it("an ADMIN signup skips about-you, contact, membership, House, and resume", () => {
    expect(ADMIN_STEPS).toEqual(["type", "code", "account"]);
    for (const step of ["about", "contact", "membership", "house", "resume"] as const) {
      expect(ADMIN_STEPS).not.toContain(step);
    }
  });

  it("a downgrade — picked EBOARD/ADMIN but the code only granted GENERAL — falls through to the full General step list, House included", () => {
    for (const picked of ["eboard", "admin"] as const) {
      const steps = stepsFor(picked, "general");
      expect(steps).toEqual(["type", "code", ...GENERAL_STEPS.slice(1)]);
      // The RESOLVED role decides, so a downgraded signup does answer House.
      expect(steps).toContain("house");
    }
  });

  it("Resume is always the last step when present, and has no equivalent gate — it stays skippable via 'Do this later'", () => {
    expect(GENERAL_STEPS[GENERAL_STEPS.length - 1]).toBe("resume");
    expect(EBOARD_STEPS[EBOARD_STEPS.length - 1]).toBe("resume");
  });
});
