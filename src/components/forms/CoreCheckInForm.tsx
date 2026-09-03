"use client";

import { Lock } from "lucide-react";
import { useState, type ReactNode } from "react";
import Description from "@/components/forms/Description";
import FileDropField from "@/components/forms/FileDropField";
import HouseBlock from "@/components/forms/HouseBlock";
import YesNo from "@/components/forms/YesNo";
import ConfirmationRow from "@/components/ui/ConfirmationRow";
import Field, { inputClass, selectClass } from "@/components/ui/Field";
import HouseDot from "@/components/ui/HouseDot";
import {
  CLASSIFICATION_OPTIONS,
  OTHER_MAJOR,
  coreField,
  getMissingFields,
  type CoreFieldKey,
  type CoreFormAnswers,
} from "@/lib/core-form";
import type { House } from "@/lib/houses";
import type { Member } from "@/lib/types";

export interface CoreCheckInFormValue extends Partial<CoreFormAnswers> {
  houseFilename?: string;
  resumeFilename?: string;
}

export interface CoreCheckInFormConfig {
  majors: string[];
  houses: House[];
  membershipSiteUrl: string;
  houseTestUrl: string;
  nationalMembershipUrl: string;
  /** Config.SEASON — drives every seasonal re-ask (classification/major via profileSeason, dues/national via membershipSeason). See lib/core-form.ts getMissingFields. */
  currentSeason: string;
}

/** aria-live region so a newly-revealed required field is announced; skips the transition under prefers-reduced-motion. */
function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div
      aria-live="polite"
      className={`grid transition-[grid-template-rows] duration-150 motion-reduce:transition-none ${
        show ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="overflow-hidden">{show ? <div className="flex flex-col gap-4 pt-4">{children}</div> : null}</div>
    </div>
  );
}

type CoreCheckInMember = Pick<
  Member,
  | "firstName"
  | "lastName"
  | "studentId"
  | "phone"
  | "personalEmail"
  | "classification"
  | "major"
  | "majorOther"
  | "profileSeason"
  | "nsbeMembershipId"
  | "house"
  | "houseVerifiedAt"
  | "resumeFileId"
  | "duesPaidReported"
  | "nationalMemberReported"
  | "membershipSeason"
>;

/**
 * The check-in form is a GAP-FILLER: a field renders as a live question only
 * when lib/core-form.ts getMissingFields says it's missing, stale, or
 * answered No. Everything already on the account renders instead as a
 * read-only receipt row with an inline Edit — clicking Edit is the ONLY other
 * way a field becomes live (see `editing` below). This is the single
 * implementation other than getMissingFields itself; no label, description,
 * option list, or "what's missing" rule is duplicated here.
 */
export default function CoreCheckInForm({
  member,
  email,
  config,
  value,
  onChange,
  errors,
  disabled = false,
  reduced = false,
}: {
  member: CoreCheckInMember;
  email: string;
  config: CoreCheckInFormConfig;
  value: CoreCheckInFormValue;
  onChange: (patch: CoreCheckInFormValue) => void;
  errors: Record<string, string>;
  disabled?: boolean;
  /** EBOARD_ONLY events (Part 6) — firstName/lastName/bisonEmail only, no studentId/classification/major/membership/house/resume. */
  reduced?: boolean;
}) {
  const missing = new Set(
    getMissingFields(member, { audience: reduced ? "eboard_only" : "all" }, { SEASON: config.currentSeason }),
  );
  // The only other way a confirmed field becomes a live question — clicking
  // "Edit" on its receipt row. Missing fields are always live regardless.
  const [editing, setEditing] = useState<Set<CoreFieldKey>>(new Set());
  const isLive = (key: CoreFieldKey) => missing.has(key) || editing.has(key);
  const edit = (...keys: CoreFieldKey[]) => setEditing((prev) => new Set([...prev, ...keys]));

  const vars = {
    membershipSiteUrl: config.membershipSiteUrl,
    houseTestUrl: config.houseTestUrl,
    nationalMembershipUrl: config.nationalMembershipUrl,
  };

  const nameLive = isLive("firstName") || isLive("lastName");
  const studentIdLive = !reduced && isLive("studentId");
  const phoneLive = !reduced && isLive("phone");
  const personalEmailLive = !reduced && isLive("personalEmail");
  const classificationLive = !reduced && isLive("classification");
  const majorLive = !reduced && isLive("major");
  // isLive("majorOther") covers the server-known case (major already "Other"
  // on file with a blank majorOther); the second clause covers picking
  // "Other" fresh this session, which getMissingFields couldn't have known about.
  const majorOtherLive = !reduced && (isLive("majorOther") || (majorLive && value.major === OTHER_MAJOR));
  const duesLive = !reduced && isLive("duesPaid");
  const nationalLive = !reduced && isLive("nationalMember");
  const nsbeIdOnlyLive = !reduced && !nationalLive && isLive("nsbeMembershipId");
  const houseLive = !reduced && isLive("house");
  const resumeLive = !reduced && isLive("resume");

  // The one place preselection is correct (Part: seasonal refresh) — the
  // member is confirming a known value, not answering fresh. Only shown when
  // there's actually a prior value to confirm; a genuinely blank profile
  // just gets a plain required dropdown below, no special framing.
  const isSeasonRefresh = (classificationLive || majorLive) && Boolean(member.classification || member.major);

  const classificationLabel = CLASSIFICATION_OPTIONS.find((o) => o.value === member.classification)?.label;
  const majorDisplay = member.major === OTHER_MAJOR ? member.majorOther : member.major;
  const membershipConfirmed = !duesLive && !nationalLive;

  return (
    <div className="flex flex-col gap-8">
      {/* Receipt — everything the app already has. Not a form; a summary of what will be submitted, with an inline Edit on anything a member needs to correct. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Your info</h2>
        <div className="flex flex-col gap-2">
          {!nameLive ? (
            <ConfirmationRow
              label="Name"
              value={`${member.firstName} ${member.lastName}`}
              onEdit={() => edit("firstName", "lastName")}
            />
          ) : null}
          <div className="flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2.5 text-sm text-muted">
            <Lock size={14} aria-hidden="true" />
            <span>Bison email: {email}</span>
          </div>
          {!reduced && !studentIdLive ? (
            <ConfirmationRow label="Student ID" value={member.studentId} onEdit={() => edit("studentId")} />
          ) : null}
          {!reduced && !phoneLive ? (
            <ConfirmationRow label="Phone" value={member.phone} onEdit={() => edit("phone")} />
          ) : null}
          {!reduced && !personalEmailLive ? (
            <ConfirmationRow label="Personal email" value={member.personalEmail} onEdit={() => edit("personalEmail")} />
          ) : null}
          {!reduced && !classificationLive ? (
            <ConfirmationRow
              label="Classification"
              value={classificationLabel ?? member.classification}
              onEdit={() => edit("classification")}
            />
          ) : null}
          {!reduced && !majorLive ? (
            <ConfirmationRow label="Major" value={majorDisplay || "—"} onEdit={() => edit("major")} />
          ) : null}
          {!reduced && membershipConfirmed ? (
            <ConfirmationRow label="Membership" value="Dues paid · National member" onEdit={() => edit("duesPaid", "nationalMember")} />
          ) : null}
          {!reduced && !houseLive ? (
            <ConfirmationRow
              label="House"
              value={
                member.house ? (
                  <span className="inline-flex items-center gap-1.5">
                    <HouseDot color={config.houses.find((h) => h.name === member.house)?.color} />
                    {member.house}
                    {!member.houseVerifiedAt ? " · pending review" : ""}
                  </span>
                ) : (
                  "—"
                )
              }
              onEdit={() => edit("house")}
            />
          ) : null}
          {!reduced && !resumeLive ? <ConfirmationRow label="Resume" value="On file" onEdit={() => edit("resume")} /> : null}
        </div>
      </section>

      {/* Live gap-filler questions — only ever what's missing, stale, or being edited. */}
      {nameLive ? (
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={coreField("firstName").label} required error={errors.firstName}>
              {(id, describedBy) => (
                <input
                  id={id}
                  value={value.firstName ?? ""}
                  onChange={(e) => onChange({ firstName: e.target.value })}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  className={inputClass}
                />
              )}
            </Field>
            <Field label={coreField("lastName").label} required error={errors.lastName}>
              {(id, describedBy) => (
                <input
                  id={id}
                  value={value.lastName ?? ""}
                  onChange={(e) => onChange({ lastName: e.target.value })}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  className={inputClass}
                />
              )}
            </Field>
          </div>
        </section>
      ) : null}

      {studentIdLive ? (
        <Field label={coreField("studentId").label} required error={errors.studentId}>
          {(id, describedBy) => (
            <input
              id={id}
              value={value.studentId ?? ""}
              onChange={(e) => onChange({ studentId: e.target.value })}
              disabled={disabled}
              aria-describedby={describedBy}
              className={inputClass}
            />
          )}
        </Field>
      ) : null}

      {phoneLive ? (
        <Field label={coreField("phone").label} required error={errors.phone}>
          {(id, describedBy) => (
            <input
              id={id}
              type="tel"
              value={value.phone ?? ""}
              onChange={(e) => onChange({ phone: e.target.value })}
              disabled={disabled}
              aria-describedby={describedBy}
              className={inputClass}
            />
          )}
        </Field>
      ) : null}

      {personalEmailLive ? (
        <Field label={coreField("personalEmail").label} required error={errors.personalEmail} help={coreField("personalEmail").helpText}>
          {(id, describedBy) => (
            <input
              id={id}
              type="email"
              value={value.personalEmail ?? ""}
              onChange={(e) => onChange({ personalEmail: e.target.value })}
              disabled={disabled}
              aria-describedby={describedBy}
              className={inputClass}
            />
          )}
        </Field>
      ) : null}

      {classificationLive || majorLive || majorOtherLive ? (
        <section className="flex flex-col gap-4">
          {isSeasonRefresh ? (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Update for the new season</h2>
          ) : null}

          {classificationLive ? (
            <Field label={coreField("classification").label} required error={errors.classification}>
              {(id, describedBy) => (
                <select
                  id={id}
                  value={value.classification ?? ""}
                  onChange={(e) => onChange({ classification: e.target.value as CoreFormAnswers["classification"] })}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  className={selectClass}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {CLASSIFICATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}

          {majorLive ? (
            <Field label={coreField("major").label} required error={errors.major}>
              {(id, describedBy) => (
                <select
                  id={id}
                  value={value.major ?? ""}
                  onChange={(e) => onChange({ major: e.target.value, majorOther: e.target.value === OTHER_MAJOR ? value.majorOther : undefined })}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  className={selectClass}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {config.majors.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value={OTHER_MAJOR}>{OTHER_MAJOR}</option>
                </select>
              )}
            </Field>
          ) : null}

          {majorOtherLive ? (
            <Field label={coreField("majorOther").label} required error={errors.majorOther}>
              {(id, describedBy) => (
                <input
                  id={id}
                  value={value.majorOther ?? ""}
                  onChange={(e) => onChange({ majorOther: e.target.value })}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  className={inputClass}
                />
              )}
            </Field>
          ) : null}
        </section>
      ) : null}

      {duesLive || nationalLive || nsbeIdOnlyLive ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Membership</h2>

          {duesLive ? (
            <Field label={coreField("duesPaid").label} required error={errors.duesPaid}>
              {(id, describedBy) => (
                <div className="flex flex-col gap-2">
                  <YesNo
                    id={id}
                    label={coreField("duesPaid").label}
                    value={value.duesPaid}
                    onChange={(v) => onChange({ duesPaid: v })}
                    error={errors.duesPaid}
                    describedBy={describedBy}
                  />
                  <Description text={coreField("duesPaid").description ?? ""} vars={vars} />
                </div>
              )}
            </Field>
          ) : null}

          {nationalLive ? (
            <>
              <Field label={coreField("nationalMember").label} required error={errors.nationalMember}>
                {(id, describedBy) => (
                  <div className="flex flex-col gap-2">
                    <YesNo
                      id={id}
                      label={coreField("nationalMember").label}
                      value={value.nationalMember}
                      onChange={(v) => onChange({ nationalMember: v, nsbeMembershipId: v ? value.nsbeMembershipId : undefined })}
                      error={errors.nationalMember}
                      describedBy={describedBy}
                    />
                    <Description text={coreField("nationalMember").description ?? ""} vars={vars} />
                  </div>
                )}
              </Field>

              <Reveal show={value.nationalMember === true}>
                <Field label={coreField("nsbeMembershipId").label}>
                  {(id) => (
                    <input
                      id={id}
                      value={value.nsbeMembershipId ?? ""}
                      onChange={(e) => onChange({ nsbeMembershipId: e.target.value })}
                      disabled={disabled}
                      className={inputClass}
                    />
                  )}
                </Field>
              </Reveal>
            </>
          ) : null}

          {nsbeIdOnlyLive ? (
            <Field label={coreField("nsbeMembershipId").label}>
              {(id) => (
                <input
                  id={id}
                  value={value.nsbeMembershipId ?? ""}
                  onChange={(e) => onChange({ nsbeMembershipId: e.target.value })}
                  disabled={disabled}
                  className={inputClass}
                />
              )}
            </Field>
          ) : null}
        </section>
      ) : null}

      {houseLive ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">NSBE House</h2>
          <HouseBlock
            houses={config.houses}
            houseTestUrl={config.houseTestUrl}
            value={{
              house: value.house,
              houseProofFileId: value.houseProofFileId,
              houseFilename: value.houseFilename,
              houseSkipped: value.houseSkipped,
            }}
            onChange={onChange}
            errors={{ house: errors.house, houseProofFileId: errors.houseProofFileId }}
            disabled={disabled}
          />
        </section>
      ) : null}

      {resumeLive ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Resume</h2>
          {member.resumeFileId ? (
            <>
              <div className="flex gap-4" role="radiogroup" aria-label="Resume">
                {(
                  [
                    { value: "keep", label: "Keep Current Resume" },
                    { value: "upload", label: "Upload Updated Resume" },
                  ] as const
                ).map((opt) => (
                  <label key={opt.value} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="resumeAction"
                      checked={(value.resumeAction ?? "keep") === opt.value}
                      onChange={() => onChange({ resumeAction: opt.value })}
                      className="h-4 w-4"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <Reveal show={value.resumeAction === "upload"}>
                <FileDropField
                  label={coreField("resumeFileId").label}
                  kind="resume"
                  accept=".pdf,.doc,.docx"
                  error={errors.resumeFileId}
                  filename={value.resumeFilename ?? null}
                  onUploaded={(fileId, filename) => onChange({ resumeFileId: fileId, resumeFilename: filename })}
                  onClear={() => onChange({ resumeFileId: undefined, resumeFilename: undefined })}
                  disabled={disabled}
                />
              </Reveal>
            </>
          ) : (
            <FileDropField
              label={coreField("resumeFileId").label}
              help={coreField("resumeFileId").description}
              kind="resume"
              accept=".pdf,.doc,.docx"
              error={errors.resumeFileId}
              filename={value.resumeFilename ?? null}
              onUploaded={(fileId, filename) => onChange({ resumeFileId: fileId, resumeAction: "upload", resumeFilename: filename })}
              onClear={() => onChange({ resumeFileId: undefined, resumeAction: undefined, resumeFilename: undefined })}
              disabled={disabled}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
