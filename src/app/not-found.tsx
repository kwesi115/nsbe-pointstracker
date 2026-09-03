import { CompassIcon } from "lucide-react";
import Link from "next/link";
import EmptyState from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <EmptyState
        icon={CompassIcon}
        title="Page not found"
        description="That link doesn't lead anywhere — double-check the URL or head back to the dashboard."
        action={
          <Link href="/dashboard" className="text-sm font-semibold text-signal underline underline-offset-2">
            Go to dashboard
          </Link>
        }
      />
    </main>
  );
}
