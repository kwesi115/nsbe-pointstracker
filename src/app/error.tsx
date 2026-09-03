"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ui/ErrorState";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <ErrorState
        title="Something went wrong"
        description="That action didn't go through. Try again, or head back if it keeps happening."
        onRetry={reset}
      />
    </main>
  );
}
