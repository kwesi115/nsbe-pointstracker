import { useId, type ReactNode } from "react";

export const inputClass =
  "min-h-11 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-signal disabled:opacity-50";

export const selectClass = inputClass;
export const textareaClass = `${inputClass} min-h-24`;

/**
 * Label + control + help/error, with htmlFor wired to the control's id. Pass
 * the input/select/textarea as a render prop so Field owns id generation
 * (via useId) without every call site inventing its own.
 */
export default function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-alert">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children(id, describedBy)}
      {help ? (
        <p id={helpId} className="text-xs text-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
