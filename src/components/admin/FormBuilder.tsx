"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { copyFormAction, saveFormAction } from "@/app/(member)/admin/events/actions";
import FormRenderer from "@/components/forms/FormRenderer";
import Button from "@/components/ui/Button";
import { inputClass, selectClass, textareaClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import type { FormFieldInput } from "@/lib/repo";
import type { FieldType, FormField } from "@/lib/types";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "select", label: "Select (one)" },
  { value: "multi_select", label: "Select (multiple)" },
  { value: "number", label: "Number" },
  { value: "yes_no", label: "Yes / No" },
  { value: "rating", label: "Rating (1–5)" },
  { value: "date", label: "Date" },
];

// classification/major/house/dues/national/resume are core-form questions now
// (see lib/core-form.ts) — not available here since extra questions can't
// duplicate what's always asked.
const PREFILL_SOURCES = ["", "firstName", "lastName", "studentId", "membership"];

function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

interface BuilderField extends FormFieldInput {
  _localId: string;
  _persisted: boolean;
}

function toBuilderFields(fields: FormFieldInput[]): BuilderField[] {
  return fields.map((f, i) => ({
    fieldKey: f.fieldKey,
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options,
    helpText: f.helpText,
    order: i,
    prefill: f.prefill,
    _localId: `persisted-${f.fieldKey}`,
    _persisted: true,
  }));
}

export default function FormBuilder({
  eventId,
  initialFields,
  locked,
  otherEvents,
  maxQuestions = 5,
}: {
  eventId: string;
  initialFields: FormField[];
  locked: boolean;
  otherEvents: Array<{ eventId: string; name: string }>;
  /** Client-side UX guard only — the real ceiling is server-side, see repo.saveFormFields. */
  maxQuestions?: number;
}) {
  const [fields, setFields] = useState<BuilderField[]>(() => toBuilderFields(initialFields));
  const [copyFrom, setCopyFrom] = useState("");
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();
  const dragIndex = useId();

  function update(localId: string, patch: Partial<BuilderField>) {
    setFields((prev) => prev.map((f) => (f._localId === localId ? { ...f, ...patch } : f)));
  }

  function updateLabel(field: BuilderField, label: string) {
    const keyLocked = field._persisted && locked;
    update(field._localId, keyLocked ? { label } : { label, fieldKey: slugify(label) });
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        fieldKey: "",
        label: "",
        type: "short_text",
        required: false,
        options: [],
        helpText: "",
        order: prev.length,
        prefill: "",
        _localId: `new-${Date.now()}-${Math.random()}`,
        _persisted: false,
      },
    ]);
  }

  function removeField(localId: string) {
    setFields((prev) => prev.filter((f) => f._localId !== localId));
  }

  function move(from: number, to: number) {
    setFields((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function handleSave() {
    const payload: FormFieldInput[] = fields.map((f, i) => ({
      fieldKey: f.fieldKey || slugify(f.label) || `field_${i}`,
      label: f.label,
      type: f.type,
      required: f.required,
      options: f.options,
      helpText: f.helpText,
      order: i,
      prefill: f.prefill,
    }));
    startTransition(async () => {
      const result = await saveFormAction(eventId, payload);
      if (result.error) {
        show(result.error, "error");
      } else {
        show("Form saved");
        if (result.fields) setFields(toBuilderFields(result.fields));
      }
    });
  }

  function handleCopy() {
    if (!copyFrom) return;
    startTransition(async () => {
      const result = await copyFormAction(eventId, copyFrom);
      if (result.error) show(result.error, "error");
      else {
        show("Questions copied");
        if (result.fields) setFields(toBuilderFields(result.fields));
      }
    });
  }

  const previewFields: FormField[] = fields.map((f) => ({
    eventId,
    fieldKey: f.fieldKey || slugify(f.label || "field"),
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options,
    helpText: f.helpText,
    order: f.order,
    prefill: f.prefill,
  }));

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        {locked ? (
          <p className="rounded-lg border border-amber bg-amber/10 px-3 py-2 text-sm text-ink">
            Responses already exist for this event — existing questions can&apos;t be removed, renamed, or change
            type. New questions must be optional.
          </p>
        ) : null}

        {otherEvents.length > 0 && fields.length === 0 ? (
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted">
              Copy questions from a previous event
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={selectClass}>
                <option value="">Select an event…</option>
                {otherEvents.map((e) => (
                  <option key={e.eventId} value={e.eventId}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="secondary" disabled={!copyFrom || isPending} onClick={handleCopy}>
              Copy
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {fields.map((field, index) => {
            const keyLocked = field._persisted && locked;
            return (
              <div
                key={field._localId}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(dragIndex, String(index))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData(dragIndex));
                  if (!Number.isNaN(from)) move(from, index);
                }}
                className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
              >
                <div className="flex items-start gap-2">
                  <GripVertical size={18} className="mt-2.5 shrink-0 cursor-grab text-muted" aria-hidden="true" />
                  <div className="grid flex-1 grid-cols-2 gap-3">
                    <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted">
                      Label
                      <input
                        value={field.label}
                        onChange={(e) => updateLabel(field, e.target.value)}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Type
                      <select
                        value={field.type}
                        disabled={keyLocked}
                        onChange={(e) => update(field._localId, { type: e.target.value as FieldType })}
                        className={selectClass}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Prefill from
                      <select
                        value={field.prefill}
                        onChange={(e) => update(field._localId, { prefill: e.target.value })}
                        className={selectClass}
                      >
                        {PREFILL_SOURCES.map((s) => (
                          <option key={s} value={s}>
                            {s || "None"}
                          </option>
                        ))}
                      </select>
                    </label>
                    {field.type === "select" || field.type === "multi_select" ? (
                      <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted">
                        Options (one per line)
                        <textarea
                          value={field.options.join("\n")}
                          onChange={(e) =>
                            update(field._localId, { options: e.target.value.split("\n").map((o) => o.trim()).filter(Boolean) })
                          }
                          className={textareaClass}
                        />
                      </label>
                    ) : null}
                    <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted">
                      Help text
                      <input
                        value={field.helpText}
                        onChange={(e) => update(field._localId, { helpText: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={field.required}
                      disabled={!field._persisted && locked}
                      onChange={(e) => update(field._localId, { required: e.target.checked })}
                      className="h-4 w-4"
                    />
                    Required
                    {!field._persisted && locked ? (
                      <span className="text-xs text-muted">(must be optional — responses already exist)</span>
                    ) : null}
                  </label>
                  <button
                    type="button"
                    disabled={keyLocked}
                    onClick={() => removeField(field._localId)}
                    title={keyLocked ? "Responses already exist for this event" : "Remove field"}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-alert hover:bg-alert/10 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <Button type="button" variant="secondary" onClick={addField} disabled={fields.length >= maxQuestions} className="self-start">
          <Plus size={16} aria-hidden="true" /> Add field
        </Button>
        {fields.length >= maxQuestions ? (
          <p className="text-xs text-muted">Reached the max of {maxQuestions} extra questions for this event.</p>
        ) : null}

        <Button type="button" onClick={handleSave} disabled={isPending} className="self-start">
          {isPending ? "Saving…" : "Save form"}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Live preview</h2>
        <div className="rounded-xl border border-line bg-surface p-5">
          {previewFields.length === 0 ? (
            <p className="text-sm text-muted">No questions yet — this is exactly what a member with an empty form sees.</p>
          ) : (
            <FormRenderer fields={previewFields} values={{}} onChange={() => {}} />
          )}
        </div>
      </div>
    </div>
  );
}
