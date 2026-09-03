import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import Button from "./Button";

export default function ErrorState({
  title = "Something went wrong",
  description,
  retryLabel = "Try again",
  onRetry,
}: {
  title?: string;
  description?: ReactNode;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-alert/30 bg-alert/5 px-6 py-10 text-center"
    >
      <AlertTriangle size={28} className="text-alert" aria-hidden="true" />
      <h3 className="font-display text-base font-bold text-ink">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {onRetry ? (
        <Button type="button" variant="secondary" onClick={onRetry} className="mt-1">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
