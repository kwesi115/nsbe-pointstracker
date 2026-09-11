import type { Denial } from "./types";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "EVENT_NOT_OPEN"
  | "EVENT_CLOSED_DURING_SUBMIT"
  | "ALREADY_REGISTERED"
  | "VALIDATION_FAILED"
  | "SCHEMA_LOCKED"
  | "TOO_MANY_ATTEMPTS"
  | "ACCOUNT_NOT_ACTIVE"
  | "BAD_CODE"
  | "LAST_ADMIN"
  // A submission that repeats one already applied — same requestToken (see
  // prisma/schema.prisma model RequestClaim). Not a failure of the caller's
  // intent: the first request did the work, and this one deliberately did
  // nothing rather than issue a second credential.
  | "DUPLICATE_REQUEST";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EVENT_NOT_OPEN: 403,
  EVENT_CLOSED_DURING_SUBMIT: 403,
  ALREADY_REGISTERED: 409,
  VALIDATION_FAILED: 422,
  SCHEMA_LOCKED: 409,
  TOO_MANY_ATTEMPTS: 429,
  ACCOUNT_NOT_ACTIVE: 403,
  BAD_CODE: 403,
  LAST_ADMIN: 409,
  DUPLICATE_REQUEST: 409,
};

export interface AppErrorOptions {
  fieldErrors?: Record<string, string>;
  status?: number;
  cause?: unknown;
  denial?: Denial;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;
  /**
   * On a FORBIDDEN, WHICH requirement the caller missed — set by the guards in
   * lib/access.ts so a Server Action or a Route Handler can report the specific
   * reason ("requires the Membership audit permission") rather than a generic
   * "admin access required".
   *
   * Deliberately NOT relied on by any error boundary: Next.js strips the
   * message and every custom property off a Server Component error before it
   * reaches error.tsx in production, so a boundary would always see this as
   * undefined there. Pages carry the denial as a value instead — see
   * lib/access.ts guardAdminPage.
   */
  readonly denial?: Denial;

  constructor(code: ErrorCode, message?: string, options?: AppErrorOptions) {
    super(message ?? code, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = options?.status ?? STATUS_BY_CODE[code];
    if (options?.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options?.denial) this.denial = options.denial;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
