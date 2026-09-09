"use client";

import { useTransition } from "react";
import { grantPermissionAction, revokePermissionAction } from "@/app/(member)/admin/members/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { PermissionName } from "@/lib/types";

const LABEL: Record<PermissionName, string> = {
  verifications_write: "Verify dues/national/House (/admin/verifications)",
};

/** ADMIN-only escape valve for "this one member needs exactly one EBOARD-gated surface" without promoting their role — see lib/permissions.ts. Revoking takes effect on that member's very next request, not their next sign-in. */
export default function PermissionsPanel({ email, granted }: { email: string; granted: PermissionName[] }) {
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();
  const has = (p: PermissionName) => granted.includes(p);

  const toggle = (permission: PermissionName) => {
    startTransition(async () => {
      const action = has(permission) ? revokePermissionAction : grantPermissionAction;
      const result = await action(email, permission);
      if (result.error) show(result.error, "error");
      else show(has(permission) ? `Revoked — takes effect on their next request` : `Granted ${LABEL[permission]}`);
    });
  };

  const permissions: PermissionName[] = ["verifications_write"];

  return (
    <div className="flex flex-col gap-2">
      {permissions.map((p) => (
        <div key={p} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
          <Badge tone={has(p) ? "signal" : "muted"}>{has(p) ? "Granted" : "Not granted"}</Badge>
          <span className="text-sm text-ink">{LABEL[p]}</span>
          <Button type="button" variant="ghost" disabled={isPending} onClick={() => toggle(p)} className="ml-auto">
            {has(p) ? "Revoke" : "Grant"}
          </Button>
        </div>
      ))}
    </div>
  );
}
