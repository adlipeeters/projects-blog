/**
 * The error taxonomy. Pure TypeScript, no AWS imports, so the domain layer can throw these too.
 *
 * Spec section 7: errors map to `{ code, message }` with 400 validation, 404 not found,
 * 409 sold out or conflict, 410 hold expired, 422 idempotency mismatch.
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'SOLD_OUT'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'HOLD_EXPIRED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'CORRUPT_ITEM'
  | 'INTERNAL';

/** Extra fields returned to the client alongside the message. Never put PII in here. */
export type ErrorDetails = Readonly<Record<string, string | number | boolean>>;

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;

  /**
   * Whether this error's message is safe to return to the client.
   *
   * Client errors explain themselves. Server errors do not: their messages carry keys, item
   * shapes and internal state that belong in the logs, not in a response body.
   */
  abstract readonly expose: boolean;

  readonly details: ErrorDetails;

  constructor(message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/** 400. Zod rejected the request, or a value is outside its documented bounds. */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED' as const;
  readonly httpStatus = 400;
  readonly expose = true;
}

/** 404. */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly httpStatus = 404;
  readonly expose = true;
}

/** 409. Every stock bucket of the SKU is empty. */
export class SoldOutError extends AppError {
  readonly code = 'SOLD_OUT' as const;
  readonly httpStatus = 409;
  readonly expose = true;

  constructor(sku: string) {
    super('The requested item is sold out', { sku });
  }
}

/** 409. A condition expression failed, or retries ran out on transaction conflicts. */
export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
  readonly httpStatus = 409;
  readonly expose = true;
}

/** 409. The domain refused a status change (spec section 3). */
export class InvalidTransitionError extends AppError {
  readonly code = 'INVALID_TRANSITION' as const;
  readonly httpStatus = 409;
  readonly expose = true;

  constructor(from: string, to: string) {
    super('That order status change is not allowed', { from, to });
  }
}

/** 410. The hold's `expiresAt` had passed, so confirm lost to the sweeper. */
export class HoldExpiredError extends AppError {
  readonly code = 'HOLD_EXPIRED' as const;
  readonly httpStatus = 410;
  readonly expose = true;

  constructor(holdId: string) {
    super('That hold has expired', { holdId });
  }
}

/** 422. The same idempotency key arrived with a different request body. */
export class IdempotencyMismatchError extends AppError {
  readonly code = 'IDEMPOTENCY_MISMATCH' as const;
  readonly httpStatus = 422;
  readonly expose = true;
}

/**
 * 500. An item in DynamoDB did not match its Zod schema.
 *
 * Carries the key so the log line identifies the item, which is exactly why the message is never
 * returned to the client. Bad or legacy items must surface loudly instead of leaking `undefined`
 * into the domain (spec section 3).
 */
export class CorruptItemError extends AppError {
  readonly code = 'CORRUPT_ITEM' as const;
  readonly httpStatus = 500;
  readonly expose = false;

  constructor(entityType: string, key: Readonly<Record<string, string>>, reason: string) {
    super(`Corrupt ${entityType} item ${JSON.stringify(key)}: ${reason}`, { entityType });
  }
}

/** 500. Anything unexpected. */
export class InternalError extends AppError {
  readonly code = 'INTERNAL' as const;
  readonly httpStatus = 500;
  readonly expose = false;
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

export type ErrorBody = {
  readonly code: ErrorCode;
  readonly message: string;
} & Partial<ErrorDetails>;

/**
 * The single place an error becomes a response. Unknown throwables and non-exposed errors become
 * a flat 500 so internal state never reaches a client.
 */
export function toErrorResponse(error: unknown): { status: number; body: ErrorBody } {
  if (isAppError(error)) {
    if (!error.expose) {
      return { status: error.httpStatus, body: { code: error.code, message: 'Internal error' } };
    }
    return {
      status: error.httpStatus,
      body: { code: error.code, message: error.message, ...error.details },
    };
  }
  return { status: 500, body: { code: 'INTERNAL', message: 'Internal error' } };
}
