"use client";

import { useState, useTransition } from "react";
import { removeResumeAction, replaceResumeAction } from "@/app/(member)/account/actions";
import FileDropField from "@/components/forms/FileDropField";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import type { Member } from "@/lib/types";

type ResumeMember = Pick<Member, "resumeFileId" | "resumeUpdatedAt" | "resumeConsentAt">;

/** Current file with name/date/download, Replace, and a Remove that withdraws consent (lib/repo.ts removeResume). */
export default function ResumeSection({ member }: { member: ResumeMember }) {
  const [replacing, setReplacing] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [newFileId, setNewFileId] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  function saveReplace() {
    if (!newFileId) return;
    startTransition(async () => {
      const result = await replaceResumeAction(newFileId);
      if (result.error) {
        show(result.error, "error");
      } else {
        show("Resume updated");
        setReplacing(false);
        setFilename(null);
        setNewFileId(undefined);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeResumeAction();
      if (result.error) show(result.error, "error");
      else show("Resume removed");
    });
  }

  return (
    <section id="resume" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Resume</h2>
      <Card>
        {member.resumeFileId && !replacing ? (
          <div className="flex flex-col gap-3">
            <div>
              <a
                href={`/api/files/${member.resumeFileId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-signal underline underline-offset-2"
              >
                View current resume
              </a>
              <p className="text-xs text-muted">
                Uploaded {formatDateTime(member.resumeUpdatedAt)}
                {member.resumeConsentAt ? ` · consent given ${formatDateTime(member.resumeConsentAt)}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setReplacing(true)} disabled={isPending}>
                Replace
              </Button>
              <Button type="button" variant="danger" onClick={remove} disabled={isPending}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <FileDropField
              label={member.resumeFileId ? "Upload a replacement resume" : "Upload Your Resume (Optional)"}
              help="By uploading your resume, you consent to Howard NSBE sharing it with employers for recruiting and professional opportunities."
              kind="resume"
              accept=".pdf,.doc,.docx"
              filename={filename}
              onUploaded={(fileId, name) => {
                setNewFileId(fileId);
                setFilename(name);
              }}
              onClear={() => {
                setNewFileId(undefined);
                setFilename(null);
              }}
            />
            <div className="flex gap-2">
              {member.resumeFileId ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setReplacing(false);
                    setFilename(null);
                    setNewFileId(undefined);
                  }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="button" onClick={saveReplace} disabled={isPending || !newFileId}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
