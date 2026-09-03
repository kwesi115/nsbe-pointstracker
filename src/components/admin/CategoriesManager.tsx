"use client";

import { Fragment, useActionState, useState } from "react";
import {
  createCategoryAction,
  updateCategoryAction,
  type CategoryActionState,
} from "@/app/(member)/admin/settings/categories/actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass, selectClass, textareaClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import type { Audience, EventCategory } from "@/lib/types";

const INITIAL_STATE: CategoryActionState = { error: null };

function CategoryFields({ category }: { category?: EventCategory }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Code" required help="Uppercase, unique — e.g. GBM, AEX_CI.">
          {(id) => <input id={id} name="code" required defaultValue={category?.code} className={inputClass} />}
        </Field>
        <Field label="Short name" required help='Shown on event cards, e.g. "GBM".'>
          {(id) => <input id={id} name="shortName" required defaultValue={category?.shortName} className={inputClass} />}
        </Field>
      </div>
      <Field label="Name" required>
        {(id) => <input id={id} name="name" required defaultValue={category?.name} className={inputClass} />}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tier" help="Blank for non-tiered categories (NSBE Week, E-Board).">
          {(id) => <input id={id} type="number" name="tier" defaultValue={category?.tier ?? ""} className={inputClass} />}
        </Field>
        <Field label="Member points" required>
          {(id) => <input id={id} type="number" name="memberPoints" required defaultValue={category?.memberPoints ?? 0} className={inputClass} />}
        </Field>
      </div>
      {category ? (
        <p className="rounded-lg bg-amber/10 px-3 py-2 text-xs text-ink">
          Points are derived, not stored — changing "Member points" here changes every past registration in this
          category&apos;s contribution to the leaderboard immediately, with no backfill.{" "}
          <a
            href="/api/admin/export/leaderboard/csv"
            className="font-semibold text-signal underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            Export current standings to CSV
          </a>{" "}
          first if you want a record of today&apos;s totals.
        </p>
      ) : null}
      <Field label="Examples" help="Shown to admins building events — not visible to members.">
        {(id) => <textarea id={id} name="examples" defaultValue={category?.examples} className={textareaClass} />}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Default audience">
          {(id) => (
            <select id={id} name="audience" defaultValue={(category?.audience as Audience) ?? "all"} className={selectClass}>
              <option value="all">All members</option>
              <option value="eboard_only">E-Board only</option>
            </select>
          )}
        </Field>
        <Field label="Sort order">
          {(id) => <input id={id} type="number" name="sortOrder" defaultValue={category?.sortOrder ?? 0} className={inputClass} />}
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="countsForMonthly" defaultChecked={category?.countsForMonthly ?? true} className="h-4 w-4" />
          Counts toward Monthly Engagement Champion
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="eboardEligible" defaultChecked={category?.eboardEligible ?? true} className="h-4 w-4" />
          Contributes to the internal E-Board track
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="active" defaultChecked={category?.active ?? true} className="h-4 w-4" />
          Active
        </label>
      </div>
    </>
  );
}

function EditCategoryForm({ category, onDone }: { category: EventCategory; onDone: () => void }) {
  const boundAction = updateCategoryAction.bind(null, category.id);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4 border-t border-line pt-4">
      <CategoryFields category={category} />
      {state.error ? <p className="text-sm font-medium text-alert">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function NewCategoryForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(createCategoryAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <CategoryFields />
      {state.error ? <p className="text-sm font-medium text-alert">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create category"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function CategoriesManager({ categories }: { categories: EventCategory[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <Table>
          <Thead>
            <th className={thClass}>Code</th>
            <th className={thClass}>Name</th>
            <th className={thClass}>Tier</th>
            <th className={thClass}>Points</th>
            <th className={thClass}>Monthly</th>
            <th className={thClass}>E-Board</th>
            <th className={thClass}>Active</th>
            <th className={thClass}></th>
          </Thead>
          <tbody>
            {categories.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-b border-line last:border-0">
                  <td className={tdClass}>{c.code}</td>
                  <td className={tdClass}>
                    {c.name}
                    <div className="text-xs text-muted">{c.shortName}</div>
                  </td>
                  <td className={`${tdClass} numeric`}>{c.tier ?? "—"}</td>
                  <td className={`${tdClass} numeric`}>{c.memberPoints}</td>
                  <td className={tdClass}>{c.countsForMonthly ? "Yes" : "No"}</td>
                  <td className={tdClass}>{c.eboardEligible ? "Yes" : "No"}</td>
                  <td className={tdClass}>{c.active ? "Yes" : "No"}</td>
                  <td className={tdClass}>
                    <button
                      type="button"
                      onClick={() => setEditingId(editingId === c.id ? null : c.id)}
                      className="text-xs font-semibold text-signal underline underline-offset-2"
                    >
                      {editingId === c.id ? "Close" : "Edit"}
                    </button>
                  </td>
                </tr>
                {editingId === c.id ? (
                  <tr>
                    <td colSpan={8} className="bg-surface-sunken px-4 py-4">
                      <EditCategoryForm category={c} onDone={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </Table>
      </Card>

      {creating ? (
        <Card>
          <NewCategoryForm onDone={() => setCreating(false)} />
        </Card>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setCreating(true)} className="self-start">
          New category
        </Button>
      )}
    </div>
  );
}
