/**
 * The shared Classification formatter.
 *
 * The stored enum is lowercase, and several surfaces used to render it raw — so
 * the roster showed "junior" while the dropdown that set it showed "Junior".
 * There is now one formatter, and its labels come from the same
 * CLASSIFICATION_OPTIONS array every picker renders, which is what stops the
 * control that writes a value and the table that reads it back from drifting.
 */

import { describe, expect, it } from "vitest";
import { CLASSIFICATION_OPTIONS } from "./core-form";
import { formatClassification } from "./format";
import type { Classification } from "./types";

describe("formatClassification", () => {
  it("renders every classification in title case", () => {
    expect(formatClassification("freshman")).toBe("Freshman");
    expect(formatClassification("sophomore")).toBe("Sophomore");
    expect(formatClassification("junior")).toBe("Junior");
    expect(formatClassification("senior")).toBe("Senior");
    expect(formatClassification("graduate")).toBe("Graduate Student");
  });

  it("covers every value the enum can hold — a new one cannot slip through unformatted", () => {
    for (const option of CLASSIFICATION_OPTIONS) {
      const formatted = formatClassification(option.value);
      expect(formatted).toBe(option.label);
      // Title case: never the raw lowercase value.
      expect(formatted).not.toBe(option.value);
      expect(formatted[0]).toBe(formatted[0].toUpperCase());
    }
  });

  it("uses exactly the labels the pickers show, so a control and a table never disagree", () => {
    // The same array CoreCheckInForm, JoinWizard, ProfileSection and
    // AdminProfilePanel render their <option>s from.
    expect(CLASSIFICATION_OPTIONS.map((o) => formatClassification(o.value))).toEqual(
      CLASSIFICATION_OPTIONS.map((o) => o.label),
    );
  });

  it("renders nothing for an unset value, leaving the caller to show its own placeholder", () => {
    // The roster shows <EmptyValue />, the attendance table an em dash — that
    // choice stays with the surface.
    expect(formatClassification("")).toBe("");
    expect(formatClassification(null)).toBe("");
    expect(formatClassification(undefined)).toBe("");
  });

  it("passes through an unrecognised value rather than blanking it", () => {
    // Defensive: a value from an older enum should still be legible, not vanish.
    expect(formatClassification("sophmore" as Classification)).toBe("sophmore");
  });
});
