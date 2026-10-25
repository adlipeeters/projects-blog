/**
 * One virtual buyer: take a hold, then confirm it.
 *
 * It calls `holdRepository()` directly, which is the same object the `create-hold` and
 * `confirm-hold` handlers call. Nothing about the purchase is reimplemented here, so if the handler
 * and this file ever disagree, this file is wrong (spec section 9).
 *
 * API Gateway and Lambda are not in the path on purpose. The account's Lambda concurrency quota is
 * 10, and this experiment is about what happens when many transactions land on the same stock item,
 * which is a property of the data model rather than of the compute in front of it.
 */

import { newCustomerId } from '../../src/domain/ids.js';
import type { Sku } from '../../src/domain/ids.js';
import { holdRepository } from '../../src/persistence/repositories/holds.js';
import { isAppError } from '../../src/shared/errors.js';

const holds = holdRepository();

/**
 * What became of one attempt.
 *
 * `soldOut` and `conflict` are both refusals the code is documented to produce under contention,
 * and telling them apart is the point of the whole run: an empty bucket is scarcity, a conflict is
 * two writers on one item.
 */
export type Outcome = 'confirmed' | 'soldOut' | 'conflict' | 'expired' | 'error';

export type Attempt = {
  readonly outcome: Outcome;
  /** The error code the repository raised, for anything that was not a confirmed purchase. */
  readonly code?: string;
  readonly holdMs: number;
  readonly confirmMs: number;
  readonly totalMs: number;
  readonly bucket?: number;
  readonly startedAt: number;
};

const since = (from: number): number => Math.round((performance.now() - from) * 1000) / 1000;

const classify = (error: unknown): { outcome: Outcome; code?: string } => {
  if (!isAppError(error)) {
    // The error's own name, so the summary can say what went wrong without anyone opening the
    // per-attempt records. A run that hits DynamoDB throttling lands here, and
    // `ProvisionedThroughputExceededException` in the counts is the signal, not a mystery.
    return { outcome: 'error', ...(error instanceof Error ? { code: error.name } : {}) };
  }

  switch (error.code) {
    case 'SOLD_OUT':
      return { outcome: 'soldOut', code: error.code };
    case 'CONFLICT':
      return { outcome: 'conflict', code: error.code };
    case 'HOLD_EXPIRED':
      return { outcome: 'expired', code: error.code };
    default:
      return { outcome: 'error', code: error.code };
  }
};

/**
 * One buyer, start to finish.
 *
 * A fresh customer id per attempt, because a flash sale is thousands of different people and
 * because the idempotency item lives in the customer's own partition: reusing one id would put
 * every request's idempotency write on a single partition and quietly add a second hot key to the
 * experiment.
 */
export async function buyOne(input: {
  readonly sku: Sku;
  readonly qty: number;
  readonly attempt: number;
}): Promise<Attempt> {
  const customerId = newCustomerId();
  const startedAt = performance.now();

  let holdMs = 0;

  try {
    const held = await holds.createHold({
      customerId,
      idempotencyKey: `load-${String(input.attempt)}-${customerId}`,
      lines: [{ sku: input.sku, qty: input.qty }],
    });
    holdMs = since(startedAt);

    const confirmStarted = performance.now();
    await holds.confirmHold(customerId, held.hold.holdId);

    return {
      outcome: 'confirmed',
      holdMs,
      confirmMs: since(confirmStarted),
      totalMs: since(startedAt),
      ...(held.hold.allocations[0] === undefined
        ? {}
        : { bucket: held.hold.allocations[0].bucket }),
      startedAt,
    };
  } catch (error: unknown) {
    return {
      ...classify(error),
      holdMs,
      confirmMs: 0,
      totalMs: since(startedAt),
      startedAt,
    };
  }
}
