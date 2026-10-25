/**
 * Stock holds: the flash-sale flow reserves stock first, then takes (mocked) payment.
 *
 * TTL is not the timer. DynamoDB deletes expired items within a few days, not on the second, so
 * correctness comes from comparing `expiresAt` inside the update conditions. Confirm and release
 * can therefore never both succeed, and the sweeper returns stock within about a minute
 * (spec section 7).
 */

import type { CustomerId, HoldId } from './ids.js';
import type { Allocation, OrderLine } from './order.js';

export const HOLD_STATUSES = ['HELD', 'CONFIRMED', 'RELEASED'] as const;

export type HoldStatus = (typeof HOLD_STATUSES)[number];

export type Hold = {
  readonly holdId: HoldId;
  readonly customerId: CustomerId;
  readonly status: HoldStatus;
  /** ISO-8601 UTC. The hold is dead after this instant, whether or not the item still exists. */
  readonly expiresAt: string;
  readonly allocations: readonly Allocation[];
  /** Price snapshot, so confirming does not have to re-read the catalog. */
  readonly lines: readonly OrderLine[];
  readonly createdAt: string;
  readonly version: number;
};

/** Spec section 7: ten minutes. */
export const HOLD_TTL_MINUTES = 10;

export const holdExpiry = (now: Date, minutes = HOLD_TTL_MINUTES): string =>
  new Date(now.getTime() + minutes * 60_000).toISOString();

export const isExpired = (hold: Hold, now = new Date()): boolean =>
  Date.parse(hold.expiresAt) <= now.getTime();

/** Only a HELD hold that has not expired can still be confirmed. */
export const isConfirmable = (hold: Hold, now = new Date()): boolean =>
  hold.status === 'HELD' && !isExpired(hold, now);

/**
 * One row of the sweeper's queue (AP15).
 *
 * Smaller than a Hold because the index projects only `customerId`: the hold id and its expiry are
 * already packed into the sort key, and the sweeper needs nothing else to release it.
 */
export type HoldSweepEntry = {
  readonly holdId: HoldId;
  readonly customerId: CustomerId;
  readonly expiresAt: string;
};
