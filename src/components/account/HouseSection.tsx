"use client";

import { useState, useTransition } from "react";
import { setHouseAction, skipHouseAction } from "@/app/(member)/account/actions";
import HouseBlock, { type HouseBlockValue } from "@/components/forms/HouseBlock";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import ConfirmationRow from "@/components/ui/ConfirmationRow";
import { HouseLabel } from "@/components/ui/HouseDot";
import { useToast } from "@/components/ui/Toast";
import type { House } from "@/lib/houses";
import type { Member } from "@/lib/types";

type HouseMember = Pick<Member, "house" | "houseVerifiedAt">;

/** Verified House is locked — the only path to change it is an admin correction (/admin/members/[id]). Unverified shows the same House block used at check-in and signup. */
export default function HouseSection({
  member,
  houses,
  houseTestUrl,
}: {
  member: HouseMember;
  houses: House[];
  houseTestUrl: string;
}) {
  const [value, setValue] = useState<HouseBlockValue>({ house: member.house || undefined });
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  const verified = member.houseVerifiedAt !== null;

  function save() {
    if (!value.house || !value.houseProofFileId) return;
    startTransition(async () => {
      const result = await setHouseAction(value.house!, value.houseProofFileId!);
      if (result.error) show(result.error, "error");
      else show("House submitted — pending E-Board review");
    });
  }

  function handleChange(patch: HouseBlockValue) {
    setValue((prev) => ({ ...prev, ...patch }));
    // Skipping while a House was already on file (even just pending) clears
    // it server-side immediately — the skip control's whole point is "this
    // isn't right, ask me again later," not just a client-side reset.
    if (patch.houseSkipped === true && member.house) {
      startTransition(async () => {
        const result = await skipHouseAction();
        if (result.error) show(result.error, "error");
      });
    }
  }

  return (
    <section id="house" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">NSBE House</h2>
      <Card>
        {verified ? (
          <div className="flex flex-col gap-2">
            <ConfirmationRow
              label="NSBE House"
              value={
                <>
                  <HouseLabel house={member.house} houses={houses} /> ✓
                </>
              }
            />
            <p className="text-xs text-muted">Verified. Contact an E-Board member to request a change.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {member.house && !value.houseSkipped ? <p className="text-xs text-muted">Submitted — pending E-Board review.</p> : null}
            <HouseBlock houses={houses} houseTestUrl={houseTestUrl} value={value} onChange={handleChange} disabled={isPending} />
            {!value.houseSkipped ? (
              <Button
                type="button"
                onClick={save}
                disabled={isPending || !value.house || !value.houseProofFileId}
                className="self-start"
              >
                {isPending ? "Saving…" : "Submit"}
              </Button>
            ) : null}
          </div>
        )}
      </Card>
    </section>
  );
}
