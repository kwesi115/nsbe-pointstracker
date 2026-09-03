"use client";

import Field, { inputClass, selectClass, textareaClass } from "@/components/ui/Field";
import type { AnswerValue, FormAnswers } from "@/lib/forms";
import type { FormField } from "@/lib/types";

/**
 * Renders a FormField[] as controlled inputs. Used for BOTH the member
 * check-in form and the admin builder's live preview — the same component,
 * not a mock, so what admins see while editing is exactly what members fill out.
 */
export default function FormRenderer({
  fields,
  values,
  onChange,
  errors,
  disabled = false,
}: {
  fields: FormField[];
  values: FormAnswers;
  onChange: (key: string, value: AnswerValue) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {fields.map((field, index) => (
        <FieldInput
          // Index included because the builder's live preview can transiently
          // have several fields with the same auto-derived fieldKey (e.g. two
          // blank-labeled fields both slugify to "field") before they're named.
          key={`${index}-${field.fieldKey}`}
          field={field}
          value={values[field.fieldKey]}
          onChange={(v) => onChange(field.fieldKey, v)}
          error={errors?.[field.fieldKey] ?? null}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  error,
  disabled,
}: {
  field: FormField;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  error: string | null;
  disabled: boolean;
}) {
  const label = field.label || field.fieldKey;

  switch (field.type) {
    case "short_text":
      return (
        <Field label={label} help={field.helpText} error={error} required={field.required}>
          {(id, describedBy) => (
            <input
              id={id}
              type="text"
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              aria-describedby={describedBy}
              className={inputClass}
            />
          )}
        </Field>
      );

    case "long_text":
      return (
        <Field label={label} help={field.helpText} error={error} required={field.required}>
          {(id, describedBy) => (
            <textarea
              id={id}
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              aria-describedby={describedBy}
              className={textareaClass}
            />
          )}
        </Field>
      );

    case "number":
      return (
        <Field label={label} help={field.helpText} error={error} required={field.required}>
          {(id, describedBy) => (
            <input
              id={id}
              type="number"
              value={value === undefined || value === "" ? "" : String(value)}
              onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
              disabled={disabled}
              aria-describedby={describedBy}
              className={inputClass}
            />
          )}
        </Field>
      );

    case "date":
      return (
        <Field label={label} help={field.helpText} error={error} required={field.required}>
          {(id, describedBy) => (
            <input
              id={id}
              type="date"
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              aria-describedby={describedBy}
              className={inputClass}
            />
          )}
        </Field>
      );

    case "select":
      return (
        <Field label={label} help={field.helpText} error={error} required={field.required}>
          {(id, describedBy) => (
            <select
              id={id}
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              aria-describedby={describedBy}
              className={selectClass}
            >
              <option value="" disabled>
                Select…
              </option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}
        </Field>
      );

    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field label={label} help={field.helpText} error={error} required={field.required}>
          {() => (
            <div className="flex flex-col gap-2" role="group" aria-label={label}>
              {field.options.map((opt) => {
                const checked = selected.includes(opt);
                return (
                  <label key={opt} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() =>
                        onChange(checked ? selected.filter((o) => o !== opt) : [...selected, opt])
                      }
                      className="h-4 w-4"
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          )}
        </Field>
      );
    }

    case "yes_no":
      return (
        <Field label={label} help={field.helpText} error={error} required={field.required}>
          {() => (
            <div className="flex gap-4" role="radiogroup" aria-label={label}>
              {(["Yes", "No"] as const).map((opt) => (
                <label key={opt} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name={field.fieldKey}
                    checked={value === (opt === "Yes")}
                    disabled={disabled}
                    onChange={() => onChange(opt === "Yes")}
                    className="h-4 w-4"
                  />
                  {opt}
                </label>
              ))}
            </div>
          )}
        </Field>
      );

    case "rating":
      return (
        <Field label={label} help={field.helpText} error={error} required={field.required}>
          {() => (
            <div className="flex gap-2" role="radiogroup" aria-label={label}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={value === n}
                  disabled={disabled}
                  onClick={() => onChange(n)}
                  className={`numeric flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-sm font-semibold ${
                    value === n ? "border-signal bg-signal text-white" : "border-line bg-white text-ink"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </Field>
      );
  }
}
