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
  | "LAST_ADMIN";

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
};

export interface AppErrorOptions {
  fieldErrors?: Record<string, string>;
  status?: number;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: ErrorCode, message?: string, options?: AppErrorOptions) {
    super(message ?? code, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = options?.status ?? STATUS_BY_CODE[code];
    if (options?.fieldErrors) this.fieldErrors = options.fieldErrors;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
