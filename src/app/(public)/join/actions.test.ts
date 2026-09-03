/**
 * Unit tests for the join wizard's post-signup session handling — the bug
 * this covers: createAccountAction used to return `ok: true` even when the
 * embedded signIn() failed, so the wizard silently advanced into steps that
 * require a session and then threw an uncaught UNAUTHENTICATED error. Same
 * pattern as signin/actions.test.ts: signIn()/session/org/repo are all
 * mocked so this runs without a real database or Auth.js credential check.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-forwarded-for", "127.0.0.1"]])),
}));
vi.mock("@/auth", () => ({ signIn: vi.fn(async () => undefined) }));
vi.mock("@/lib/org", () => ({ requireOrgContext: vi.fn(async () => ({ orgId: "org-1" })) }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/passwords", () => ({
  hashPassword: vi.fn(async () => "hashed"),
  validatePasswordStrength: vi.fn(() => ({ ok: true })),
}));
vi.mock("@/lib/repo", () => ({
  getConfigValue: vi.fn(async () => ""),
  getCoreFormConfig: vi.fn(async () => ({
    majors: [],
    houses: [
      { code: "TURING", name: "House Turing", color: "#C8102E" },
      { code: "HAMILTON", name: "House Hamilton", color: "#F2A900" },
    ],
  })),
  matchJoinCode: vi.fn(async () => ({ grantsRole: "general", label: "General" })),
  redeemJoinCodeForSignup: vi.fn(async () => ({
    member: {},
    grantsRole: "general",
    label: "General",
    convertedFromGuest: false,
  })),
  setDuesReported: vi.fn(async () => undefined),
  setHouseAssignment: vi.fn(async () => undefined),
  setNationalReported: vi.fn(async () => undefined),
  setResume: vi.fn(async () => undefined),
  updateProfileFields: vi.fn(async () => undefined),
}));
// The signup/join-code limiters are real in-memory Maps keyed by IP, and
// every test in this file shares the same mocked IP ("127.0.0.1") — without
// this, a handful of successful signups in one test run would trip the real
// 3-per-hour signup limiter and start failing unrelated tests below it.
vi.mock("@/lib/rate-limit", () => ({
  assertNotJoinCodeRateLimited: vi.fn(),
  recordJoinCodeAttempt: vi.fn(),
  assertNotSignupRateLimited: vi.fn(),
  recordSignupAttempt: vi.fn(),
}));

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { AppError } from "@/lib/errors";
import { getConfigValue, getCoreFormConfig, matchJoinCode, redeemJoinCodeForSignup, setHouseAssignment } from "@/lib/repo";
import { assertNotSignupRateLimited, recordSignupAttempt } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";
import { createAccountAction, setHouseAction, updateContactAction, type CreateAccountState } from "./actions";

const signInMock = signIn as unknown as ReturnType<typeof vi.fn>;
const requireSessionMock = requireSession as unknown as ReturnType<typeof vi.fn>;
const setHouseAssignmentMock = setHouseAssignment as unknown as ReturnType<typeof vi.fn>;
const getConfigValueMock = getConfigValue as unknown as ReturnType<typeof vi.fn>;
const getCoreFormConfigMock = getCoreFormConfig as unknown as ReturnType<typeof vi.fn>;
const matchJoinCodeMock = matchJoinCode as unknown as ReturnType<typeof vi.fn>;
const redeemJoinCodeForSignupMock = redeemJoinCodeForSignup as unknown as ReturnType<typeof vi.fn>;
const assertNotSignupRateLimitedMock = assertNotSignupRateLimited as unknown as ReturnType<typeof vi.fn>;
const recordSignupAttemptMock = recordSignupAttempt as unknown as ReturnType<typeof vi.fn>;

const CREATE_ACCOUNT_INITIAL: CreateAccountState = { error: null, ok: false, grantsRole: null };

function accountFormData(overrides: { code?: string; email?: string } = {}): FormData {
  const formData = new FormData();
  formData.set("code", overrides.code ?? "ABCD1234");
  formData.set("email", overrides.email ?? "new@bison.howard.edu");
  formData.set("password", "Str0ng!Passw0rd");
  formData.set("confirmPassword", "Str0ng!Passw0rd");
  formData.set("firstName", "Ada");
  formData.set("lastName", "Lovelace");
  formData.set("studentId", "12345");
  formData.set("classification", "freshman");
  formData.set("major", "Computer Science");
  return formData;
}

const SESSION = { user: { orgId: "org-1", email: "member@bison.howard.edu" } };

beforeEach(() => {
  signInMock.mockReset().mockResolvedValue(undefined);
  requireSessionMock.mockReset();
  setHouseAssignmentMock.mockReset().mockResolvedValue(undefined);
  getConfigValueMock.mockReset().mockResolvedValue("");
  getCoreFormConfigMock.mockReset().mockResolvedValue({
    majors: [],
    houses: [
      { code: "TURING", name: "House Turing", color: "#C8102E" },
      { code: "HAMILTON", name: "House Hamilton", color: "#F2A900" },
    ],
  });
  matchJoinCodeMock.mockReset().mockResolvedValue({ grantsRole: "general", label: "General" });
  redeemJoinCodeForSignupMock.mockReset().mockResolvedValue({
    member: {},
    grantsRole: "general",
    label: "General",
    convertedFromGuest: false,
  });
  assertNotSignupRateLimitedMock.mockReset();
  recordSignupAttemptMock.mockReset();
});

describe("createAccountAction", () => {
  it("signs the user in immediately after creating the account", async () => {
    const state = await createAccountAction(CREATE_ACCOUNT_INITIAL, accountFormData());

    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ email: "new@bison.howard.edu", orgId: "org-1", redirect: false }),
    );
    expect(state).toMatchObject({ ok: true, error: null });
    expect(state.redirectToSignIn).toBeFalsy();
  });

  it("does NOT report success when the post-signup sign-in fails — the wizard must not advance without a session", async () => {
    signInMock.mockRejectedValue(new (AuthError as unknown as new () => Error)());

    const state = await createAccountAction(CREATE_ACCOUNT_INITIAL, accountFormData());

    // The account itself was created (redeemJoinCodeForSignup ran and did not
    // throw) — but `ok` must stay false, or AccountStep's `if (state.ok)
    // onCreated(email)` effect fires and pushes the wizard into steps that
    // need a session that was never established.
    expect(state.ok).toBe(false);
    expect(state.redirectToSignIn).toBe(true);
    expect(state.email).toBe("new@bison.howard.edu");
  });
});

describe("createAccountAction — codeless general signup", () => {
  it("an empty code creates a GENERAL account with no error, and never previews a code at all", async () => {
    redeemJoinCodeForSignupMock.mockResolvedValue({
      member: {},
      grantsRole: "general",
      label: "No code entered",
      convertedFromGuest: false,
    });

    const state = await createAccountAction(CREATE_ACCOUNT_INITIAL, accountFormData({ code: "" }));

    expect(state).toMatchObject({ ok: true, error: null, grantsRole: "general" });
    expect(matchJoinCodeMock).not.toHaveBeenCalled();
    expect(redeemJoinCodeForSignupMock).toHaveBeenCalledWith(expect.objectContaining({ submittedCode: "" }));
  });

  it("claiming ADMIN with no code still creates a GENERAL account, no error — there is no 'claimed role' field to even send", async () => {
    // The wizard never sends what the step-1 picker said — createAccountAction
    // only ever sees `code`. This test documents that a signup with an empty
    // code always resolves to whatever redeemJoinCodeForSignup returns for a
    // blank submittedCode, which is unconditionally GENERAL (see repo.ts and
    // src/lib/joincodes.test.ts's "codeless signup" suite).
    redeemJoinCodeForSignupMock.mockResolvedValue({
      member: {},
      grantsRole: "general",
      label: "No code entered",
      convertedFromGuest: false,
    });

    const state = await createAccountAction(CREATE_ACCOUNT_INITIAL, accountFormData({ code: "" }));

    expect(state.ok).toBe(true);
    expect(state.error).toBeNull();
    expect(state.grantsRole).toBe("general");
  });

  it("claiming ADMIN with a valid EBOARD code creates an EBOARD account", async () => {
    matchJoinCodeMock.mockResolvedValue({ grantsRole: "eboard", label: "E-Board code" });
    redeemJoinCodeForSignupMock.mockResolvedValue({
      member: {},
      grantsRole: "eboard",
      label: "E-Board code",
      convertedFromGuest: false,
    });

    const state = await createAccountAction(CREATE_ACCOUNT_INITIAL, accountFormData({ code: "EBOARD01" }));

    expect(state).toMatchObject({ ok: true, error: null, grantsRole: "eboard" });
    expect(matchJoinCodeMock).toHaveBeenCalled();
    expect(redeemJoinCodeForSignupMock).toHaveBeenCalledWith(expect.objectContaining({ submittedCode: "EBOARD01" }));
  });

  it("EBOARD/ADMIN signup still requires and validates a real code — a non-matching code is rejected, not downgraded", async () => {
    matchJoinCodeMock.mockResolvedValue(null);

    const state = await createAccountAction(CREATE_ACCOUNT_INITIAL, accountFormData({ code: "WRONG001" }));

    expect(state.ok).toBe(false);
    expect(state.error).toBeTruthy();
    expect(redeemJoinCodeForSignupMock).not.toHaveBeenCalled();
  });

  it("a guest-granting code is still rejected here even with a non-empty submission", async () => {
    matchJoinCodeMock.mockResolvedValue({ grantsRole: "guest", label: "Guest pass" });

    const state = await createAccountAction(CREATE_ACCOUNT_INITIAL, accountFormData({ code: "GUEST001" }));

    expect(state.ok).toBe(false);
    expect(redeemJoinCodeForSignupMock).not.toHaveBeenCalled();
  });
});

describe("createAccountAction — the domain check never consults Config.ADMIN_EMAIL_ALLOWLIST", () => {
  it("rejects a hardcoded-admin address at signup with the plain domain error — the allowlist only exempts login", async () => {
    getConfigValueMock.mockImplementation(async (_orgId: string, key: string) =>
      key === "ALLOWED_EMAIL_DOMAIN" ? "bison.howard.edu" : "",
    );

    const state = await createAccountAction(CREATE_ACCOUNT_INITIAL, accountFormData({ email: "hunsbepres@gmail.com" }));

    expect(state.ok).toBe(false);
    expect(state.fieldErrors?.email).toContain("bison.howard.edu");
    expect(redeemJoinCodeForSignupMock).not.toHaveBeenCalled();
  });
});

describe("updateContactAction", () => {
  it("returns a graceful sessionExpired state instead of throwing when there is no session", async () => {
    requireSessionMock.mockRejectedValue(new AppError("UNAUTHENTICATED", "You must be signed in"));

    const result = await updateContactAction({ phone: "555-0100", personalEmail: "ada@example.com" });

    expect(result.sessionExpired).toBe(true);
    expect(result.error).toBeTruthy();
  });

  it("saves normally when a session is present and both fields are given", async () => {
    requireSessionMock.mockResolvedValue({ user: { orgId: "org-1", email: "member@bison.howard.edu" } });

    const result = await updateContactAction({ phone: "555-0100", personalEmail: "ada@example.com" });

    expect(result.error).toBeNull();
  });

  it("phone and personal email are required — rejected server-side even if a client check is bypassed", async () => {
    requireSessionMock.mockResolvedValue({ user: { orgId: "org-1", email: "member@bison.howard.edu" } });

    expect((await updateContactAction({ phone: "", personalEmail: "ada@example.com" })).error).toBeTruthy();
    expect((await updateContactAction({ phone: "555-0100", personalEmail: "" })).error).toBeTruthy();
    expect((await updateContactAction({ phone: "  ", personalEmail: "  " })).error).toBeTruthy();
  });
});

describe("setHouseAction — no Yes/No question; an explicit skip (both args omitted) is a complete answer", () => {
  beforeEach(() => {
    requireSessionMock.mockResolvedValue(SESSION);
  });

  it("selecting a House without a screenshot is rejected server-side", async () => {
    const result = await setHouseAction("House Turing", undefined);

    expect(result.error).toBeTruthy();
    expect(setHouseAssignmentMock).not.toHaveBeenCalled();
  });

  it("uploading a screenshot without selecting a House is rejected server-side", async () => {
    const result = await setHouseAction(undefined, "file_1");

    expect(result.error).toBeTruthy();
    expect(setHouseAssignmentMock).not.toHaveBeenCalled();
  });

  it("a House not in the org's configured list is rejected", async () => {
    const result = await setHouseAction("Not A Real House", "file_1");

    expect(result.error).toBeTruthy();
    expect(setHouseAssignmentMock).not.toHaveBeenCalled();
  });

  it("a valid House and screenshot together succeed", async () => {
    const result = await setHouseAction("House Turing", "file_1");

    expect(result.error).toBeNull();
    expect(setHouseAssignmentMock).toHaveBeenCalledWith(
      "org-1",
      "member@bison.howard.edu",
      "House Turing",
      "file_1",
      "member@bison.howard.edu",
    );
  });

  it("the skip control (both arguments omitted) completes successfully and writes nothing — house stays null", async () => {
    const result = await setHouseAction();

    expect(result.error).toBeNull();
    expect(setHouseAssignmentMock).not.toHaveBeenCalled();
  });

  it("returns a graceful sessionExpired state instead of throwing when there is no session", async () => {
    requireSessionMock.mockRejectedValue(new AppError("UNAUTHENTICATED", "You must be signed in"));

    const result = await setHouseAction();

    expect(result.sessionExpired).toBe(true);
    expect(setHouseAssignmentMock).not.toHaveBeenCalled();
  });
});
