import { CORE_FORM_FIELDS, CORE_FORM_SECTIONS, type CoreFormSection } from "@/lib/core-form";

const VISIBLE_BY_DEFAULT = new Set([
  "firstName",
  "lastName",
  "bisonEmail",
  "studentId",
  "classification",
  "major",
  "duesPaid",
  "nationalMember",
  "house",
  "resumeFileId",
]);

/**
 * Read-only — every event always asks these, so an admin building extra
 * questions doesn't duplicate them. Pulls straight from lib/core-form.ts,
 * the single source of truth for the core form's copy.
 */
export default function CoreFormPreview() {
  const sections: CoreFormSection[] = ["info", "membership", "house_resume"];
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-sunken p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Always asked</p>
      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted">{CORE_FORM_SECTIONS[section]}</p>
          <ul className="flex flex-col gap-1">
            {CORE_FORM_FIELDS.filter((f) => f.section === section && VISIBLE_BY_DEFAULT.has(f.id)).map((f) => (
              <li key={f.id} className="text-sm text-ink">
                {f.label}
                {f.required ? <span className="text-alert"> *</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
