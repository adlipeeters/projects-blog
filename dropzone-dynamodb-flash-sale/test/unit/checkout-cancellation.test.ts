import { describe, expect, it } from 'vitest';

import { sku } from '../../src/domain/ids.js';
import type { Allocation } from '../../src/domain/order.js';
import { classifyCancellation } from '../../src/persistence/repositories/orders.js';

/**
 * DynamoDB reports one cancellation reason per transaction item, in the order the items were sent,
 * and says nothing about which business rule failed. Reading those positions correctly is the
 * trickiest part of checkout, so it is pure and tested here rather than only through a container.
 *
 * Layout: position 0 is the idempotency item, then one position per stock bucket, then the order
 * header and its lines.
 */

const allocations: Allocation[] = [
  { sku: sku('TEE-M-BLK'), bucket: 3, qty: 1 },
  { sku: sku('CAP-ONE-WHT'), bucket: 0, qty: 2 },
];

const none = { Code: 'None' } as const;
const failed = { Code: 'ConditionalCheckFailed' } as const;
const conflict = { Code: 'TransactionConflict' } as const;

describe('cancellation reasons', () => {
  it('reads position 0 as "this request was already handled"', () => {
    expect(classifyCancellation([failed, none, none, none], allocations)).toEqual({
      kind: 'replay',
    });
  });

  it('names the exact buckets that refused, not just the sku', () => {
    // Position 2 is the second line's bucket.
    expect(classifyCancellation([none, none, failed, none], allocations)).toEqual({
      kind: 'rotate',
      empty: [{ sku: 'CAP-ONE-WHT', bucket: 0, qty: 2 }],
    });

    // Both lines can fail at once, and both buckets have to be remembered.
    expect(classifyCancellation([none, failed, failed, none], allocations)).toEqual({
      kind: 'rotate',
      empty: allocations,
    });
  });

  it('prefers a replay over a rotation when both are reported', () => {
    // If the key already exists, the stock conditions are irrelevant: the order was placed before.
    expect(classifyCancellation([failed, failed, none, none], allocations)).toEqual({
      kind: 'replay',
    });
  });

  it('reports contention only when no condition failed', () => {
    expect(classifyCancellation([conflict, none, none, none], allocations)).toEqual({
      kind: 'conflict',
    });

    // A failed stock condition alongside a conflict is still a rotation: the bucket is empty, and
    // retrying the same bucket after a backoff would fail again.
    expect(classifyCancellation([none, failed, conflict, none], allocations)).toEqual({
      kind: 'rotate',
      empty: [allocations[0]!],
    });
  });

  it('refuses to guess at anything else', () => {
    expect(classifyCancellation([], allocations)).toEqual({ kind: 'unexpected' });
    expect(classifyCancellation([none, none, none, none], allocations)).toEqual({
      kind: 'unexpected',
    });
    expect(
      classifyCancellation([{ Code: 'ValidationError' }, none, none, none], allocations),
    ).toEqual({ kind: 'unexpected' });
  });

  it('ignores reasons for the order and line positions, which carry no business rule', () => {
    // Position 3 is the order header. Its condition only guards against reusing an order id.
    expect(classifyCancellation([none, none, none, failed], allocations)).toEqual({
      kind: 'unexpected',
    });
  });
});
