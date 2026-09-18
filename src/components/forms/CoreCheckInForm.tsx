"use client";

import { Lock } from "lucide-react";
import type { ReactNode } from "react";
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
  SHIRT_SIZE_OPTIONS,
  askableFields,
  coreField,
  liveFields,
  type CoreFieldKey,
  type CoreFormAnswers,
  type RenderedFieldKey,
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
  | "role"
  | "firstName"
  | "lastName"
  | "studentId"
  | "phone"
  | "personalEmail"
  | "tshirtSize"
  | "classification"
  | "major"
  | "majorOther"
  | "profileSeason"
  | "house"
  | "houseVerifiedAt"
  | "resumeFileId"
  | "duesPaidReported"
  | "nationalMemberReported"
  | "membershipSeason"
>;

/**
 * Marks a live input for CheckInFlow to find when the server names it in a
 * fieldErrors payload — `data-core-field` carries the RenderedFieldKey, so
 * the lookup never depends on the useId()-generated input ids.
 */
function Live({ field, children }: { field: RenderedFieldKey; children: ReactNode }) {
  return <div data-core-field={field}>{children}</div>;
}

/**
 * The check-in form is a GAP-FILLER: a field renders as a live question only
 * when lib/core-form.ts getMissingFields says it's missing, stale, or
 * answered No. Everything already on the account renders instead as a
 * read-only receipt row with an inline Edit — clicking Edit is the ONLY other
 * way a field becomes live. Which fields are live is lib/core-form.ts
 * liveFields, the same computation CheckInFlow submits and reports as
 * `rendered` — so the server can accept exactly what was shown here. No
 * label, description, option list, or "what's missing" rule is duplicated.
 *
 * `editing` is owned by CheckInFlow rather than here: it has to know what's
 * live to build the payload, and to reveal a field the server rejected.
 */
export default function CoreCheckInForm({
  member,
  email,
  config,
  value,
  onChange,
  errors,
  editing,
  onEdit,
  disabled = false,
  reduced = false,
}: {
  member: CoreCheckInMember;
  email: string;
  config: CoreCheckInFormConfig;
  value: CoreCheckInFormValue;
  onChange: (patch: CoreCheckInFormValue) => void;
  errors: Record<string, string>;
  /** Fields the member pressed Edit on — live even though they aren't missing. */
  editing: ReadonlySet<CoreFieldKey>;
  onEdit: (...keys: CoreFieldKey[]) => void;
  disabled?: boolean;
  /** EBOARD_ONLY events (Part 6) — firstName/lastName/bisonEmail only, no studentId/classification/major/membership/house/resume. */
  reduced?: boolean;
}) {
  const event = { audience: reduced ? "eboard_only" : "all" } as const;
  const live = liveFields({ user: member, event, config: { SEASON: config.currentSeason }, editing, majorValue: value.major });
  const edit = onEdit;

  const vars = {
    membershipSiteUrl: config.membershipSiteUrl,
    houseTestUrl: config.houseTestUrl,
    nationalMembershipUrl: config.nationalMembershipUrl,
  };

  // The member-profile half of this form doesn't apply to an ADMIN (WHO YOU
  // ARE) or at an EBOARD_ONLY event (WHAT EVENT YOU'RE AT) — askableFields
  // states both reductions once, for this form and for the server.
  const showMemberFields = askableFields(member.role, event).has("nsbeMembershipId");

  const nameLive = live.has("firstName");
  const studentIdLive = live.has("studentId");
  const phoneLive = live.has("phone");
  const personalEmailLive = live.has("personalEmail");
  const tshirtSizeLive = live.has("tshirtSize");
  const classificationLive = live.has("classification");
  const majorLive = live.has("major");
  // Either the server-known case (major already "Other" on file with a blank
  // majorOther) or "Other" picked this session — liveFields covers both.
  const majorOtherLive = live.has("majorOther");
  const duesLive = live.has("duesPaid");
  const nationalLive = live.has("nationalMember");
  const houseLive = live.has("house");
  const resumeLive = live.has("resume");

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
          <div className="flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2.5 text-sm text-muted">
            <Lock size={14} aria-hidden="true" />
            <span>Bison email: {email}</span>
          </div>
          {showMemberFields && !studentIdLive ? (
            <ConfirmationRow label="Student ID" value={member.studentId} onEdit={() => edit("studentId")} />
          ) : null}
          {showMemberFields && !phoneLive ? (
            <ConfirmationRow label="Phone" value={member.phone} onEdit={() => edit("phone")} />
          ) : null}
          {showMemberFields && !personalEmailLive ? (
            <ConfirmationRow label="Personal email" value={member.personalEmail} onEdit={() => edit("personalEmail")} />
          ) : null}
          {showMemberFields && !tshirtSizeLive ? (
            <ConfirmationRow label="T-shirt size" value={member.tshirtSize} onEdit={() => edit("tshirtSize")} />
          ) : null}
          {showMemberFields && !classificationLive ? (
            <ConfirmationRow
              label="Classification"
              value={classificationLabel ?? member.classification}
              onEdit={() => edit("classification")}
            />
          ) : null}
          {showMemberFields && !majorLive ? (
            <ConfirmationRow label="Major" value={majorDisplay || "—"} onEdit={() => edit("major")} />
          ) : null}
          {showMemberFields && membershipConfirmed ? (
            <ConfirmationRow label="Membership" value="Dues paid · National member" onEdit={() => edit("duesPaid", "nationalMember")} />
          ) : null}
          {showMemberFields && !houseLive ? (
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
          {showMemberFields && !resumeLive ? <ConfirmationRow label="Resume" value="On file" onEdit={() => edit("resume")} /> : null}
        </div>
      </section>

      {/* Live gap-filler questions — only ever what's missing, stale, or being edited. */}
      {nameLive ? (
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Live field="firstName">
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
            </Live>
            <Live field="lastName">
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
            </Live>
          </div>
        </section>
      ) : null}

      {studentIdLive ? (
        <Live field="studentId">
        <Field label={coreField("studentId").label} required error={errors.studentId} help={coreField("studentId").helpText}>
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
        </Live>
      ) : null}

      {phoneLive ? (
        <Live field="phone">
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
        </Live>
      ) : null}

      {personalEmailLive ? (
        <Live field="personalEmail">
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
        </Live>
      ) : null}

      {tshirtSizeLive ? (
        <Live field="tshirtSize">
        <Field label={coreField("tshirtSize").label} required error={errors.tshirtSize} help={coreField("tshirtSize").helpText}>
          {(id, describedBy) => (
            <select
              id={id}
              value={value.tshirtSize ?? ""}
              onChange={(e) => onChange({ tshirtSize: e.target.value as CoreFormAnswers["tshirtSize"] })}
              disabled={disabled}
              aria-describedby={describedBy}
              className={selectClass}
            >
              <option value="" disabled>
                Select…
              </option>
              {SHIRT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          )}
        </Field>
        </Live>
      ) : null}

      {classificationLive || majorLive || majorOtherLive ? (
        <section className="flex flex-col gap-4">
          {isSeasonRefresh ? (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Update for the new season</h2>
          ) : null}

          {classificationLive ? (
            <Live field="classification">
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
            </Live>
          ) : null}

          {majorLive ? (
            <Live field="major">
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
            </Live>
          ) : null}

          {majorOtherLive ? (
            <Live field="majorOther">
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
            </Live>
          ) : null}
        </section>
      ) : null}

      {showMemberFields ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Membership</h2>

          {duesLive ? (
            <Live field="duesPaid">
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
            </Live>
          ) : null}

          {nationalLive ? (
            <Live field="nationalMember">
              <Field label={coreField("nationalMember").label} required error={errors.nationalMember}>
                {(id, describedBy) => (
                  <div className="flex flex-col gap-2">
                    <YesNo
                      id={id}
                      label={coreField("nationalMember").label}
                      value={value.nationalMember}
                      onChange={(v) => onChange({ nationalMember: v })}
                      error={errors.nationalMember}
                      describedBy={describedBy}
                    />
                    <Description text={coreField("nationalMember").description ?? ""} vars={vars} />
                  </div>
                )}
              </Field>
            </Live>
          ) : null}

          {/*
            Always rendered, never revealed: no Reveal, no dependence on
            value.nationalMember, and it sits beside the national question
            rather than under it. Optional, so it never enters the missing
            set (see getMissingFields) and never blocks a check-in.
          */}
          <Live field="nsbeMembershipId">
          <Field label={coreField("nsbeMembershipId").label} help={coreField("nsbeMembershipId").helpText} error={errors.nsbeMembershipId}>
            {(id, describedBy) => (
              <input
                id={id}
                value={value.nsbeMembershipId ?? ""}
                onChange={(e) => onChange({ nsbeMembershipId: e.target.value })}
                disabled={disabled}
                aria-describedby={describedBy}
                className={inputClass}
              />
            )}
          </Field>
          </Live>
        </section>
      ) : null}

      {houseLive ? (
        <section data-core-field="house" className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">NSBE House</h2>
          <HouseBlock
            houses={config.houses}
            houseTestUrl={config.houseTestUrl}
            role={member.role}
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
        <section data-core-field="resume" className="flex flex-col gap-4">
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
                  <label key={opt.value} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
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
