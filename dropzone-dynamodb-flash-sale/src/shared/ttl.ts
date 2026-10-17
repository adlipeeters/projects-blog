/**
 * TTL attributes are epoch seconds, because DynamoDB requires a Number (spec section 3).
 *
 * TTL is cleanup, never a timer: DynamoDB deletes expired items within a few days of expiry, not on
 * the second. Anything that has to happen on time is enforced by a condition on a timestamp
 * attribute instead.
 */

const SECONDS = 1;
const MINUTES = 60 * SECONDS;
const HOURS = 60 * MINUTES;
const DAYS = 24 * HOURS;

export const epochSeconds = (at: Date): number => Math.floor(at.getTime() / 1000);

export const ttlInHours = (from: Date, hours: number): number => epochSeconds(from) + hours * HOURS;

export const ttlInDays = (from: Date, days: number): number => epochSeconds(from) + days * DAYS;

/** Spec section 6: idempotency keys live for 24 hours. */
export const IDEMPOTENCY_TTL_HOURS = 24;

/** Spec section 6: a hold's item is cleaned up a day after it expires. */
export const HOLD_TTL_HOURS = 24;
