/**
 * Runtime Zod schema construction from FormField[] definitions, and answer
 * (de)serialization for the per-event Resp_{EventID} sheets. No I/O.
 */

import { z, type ZodTypeAny } from "zod";
import { AppError } from "./errors";
import type { FormField } from "./types";

export type AnswerValue = string | number | boolean | string[];
export type FormAnswers = Record<string, AnswerValue>;

function baseSchemaFor(field: FormField): ZodTypeAny {
  switch (field.type) {
    case "short_text":
      return field.required ? z.string().trim().min(1, "Required").max(2000) : z.string().max(2000);
    case "long_text":
      return field.required ? z.string().trim().min(1, "Required").max(10000) : z.string().max(10000);
    case "number":
      return z.number("Must be a number");
    case "yes_no":
      return z.boolean();
    case "rating":
      return z.number().int().min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5");
    case "date":
      return z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");
    case "select": {
      if (field.options.length === 0) return z.string();
      return z.enum(field.options as [string, ...string[]], "Not a valid option");
    }
    case "multi_select": {
      const item =
        field.options.length === 0
          ? z.string()
          : z.enum(field.options as [string, ...string[]], "Not a valid option");
      const arr = z.array(item);
      return field.required ? arr.min(1, "Select at least one option") : arr;
    }
  }
}

export function buildFormSchema(fields: FormField[]) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of fields) {
    const base = baseSchemaFor(field);
    shape[field.fieldKey] = field.required ? base : base.optional();
  }
  return z.object(shape).strict();
}

/**
 * Validates raw answers against a form's fields. Rejects unknown keys,
 * missing required fields, out-of-range select/multi_select values,
 * non-numeric numbers, and ratings outside 1-5.
 */
export function validateAnswers(fields: FormField[], answers: unknown): FormAnswers {
  const schema = buildFormSchema(fields);
  const result = schema.safeParse(answers);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    throw new AppError("VALIDATION_FAILED", "Form validation failed", { fieldErrors });
  }
  return result.data as FormAnswers;
}

/** Flattens validated answers to sheet-storable strings; multi_select joins with " | ". */
export function serializeAnswers(fields: FormField[], answers: FormAnswers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = answers[field.fieldKey];
    if (value === undefined || value === null) {
      out[field.fieldKey] = "";
    } else if (Array.isArray(value)) {
      out[field.fieldKey] = value.join(" | ");
    } else if (typeof value === "boolean") {
      out[field.fieldKey] = value ? "Yes" : "No";
    } else {
      out[field.fieldKey] = String(value);
    }
  }
  return out;
}
