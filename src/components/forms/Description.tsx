import { ExternalLink } from "lucide-react";
import { parseDescription, resolveDescription } from "@/lib/core-form";

/** Renders a core-form field's description text, resolving `{{token}}` vars and `[label](url)` links — shared by CoreCheckInForm and the signup wizard so copy/links only ever come from lib/core-form.ts. Every link opens in a new tab with an external-link icon, so it never looks like in-app navigation. */
export default function Description({ text, vars }: { text: string; vars?: Record<string, string> }) {
  const resolved = vars ? resolveDescription(text, vars) : text;
  const parts = parseDescription(resolved);
  return (
    <p className="whitespace-pre-line text-xs text-muted">
      {parts.map((p, i) =>
        p.type === "link" ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-ink"
          >
            {p.text}
            <ExternalLink size={11} aria-hidden="true" className="shrink-0" />
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}
