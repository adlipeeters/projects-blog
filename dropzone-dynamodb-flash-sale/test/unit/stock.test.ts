import { describe, expect, it } from 'vitest';

import { bucketOrder, stockIsConserved } from '../../src/domain/stock.js';

describe('bucket order', () => {
  it('visits every bucket exactly once, starting somewhere random', () => {
    const order = bucketOrder(10, () => 0.35);

    // 0.35 * 10 = 3, then rotation.
    expect(order).toEqual([3, 4, 5, 6, 7, 8, 9, 0, 1, 2]);
    expect(new Set(order).size).toBe(10);
  });

  it('handles the single-bucket case, which is load run A', () => {
    expect(bucketOrder(1, () => 0.99)).toEqual([0]);
  });

  it('never returns a bucket outside the range, including at the top of the random range', () => {
    for (const value of [0, 0.999999, 0.5]) {
      const order = bucketOrder(4, () => value);
      expect(order).toHaveLength(4);
      for (const bucket of order) {
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(4);
      }
    }
  });

  it('spreads starts across buckets, which is the entire point', () => {
    const starts = new Set(Array.from({ length: 200 }, () => bucketOrder(10)[0]));

    expect(starts.size).toBe(10);
  });

  it('rejects a bucket count that cannot be allocated from', () => {
    expect(() => bucketOrder(0)).toThrow();
    expect(() => bucketOrder(1.5)).toThrow();
  });
});

describe('stock invariant (spec section 9)', () => {
  it('holds when every unit is accounted for', () => {
    expect(stockIsConserved({ initial: 500, available: 300, inOrders: 150, inHolds: 50 })).toBe(
      true,
    );
  });

  it('fails when a unit went missing or was invented', () => {
    expect(stockIsConserved({ initial: 500, available: 299, inOrders: 150, inHolds: 50 })).toBe(
      false,
    );
    expect(stockIsConserved({ initial: 500, available: 301, inOrders: 150, inHolds: 50 })).toBe(
      false,
    );
  });
});
