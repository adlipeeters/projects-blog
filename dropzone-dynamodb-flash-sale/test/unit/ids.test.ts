import { describe, expect, it } from 'vitest';

import {
  categoryId,
  customerId,
  newOrderId,
  normalizeEmail,
  orderId,
  sku,
} from '../../src/domain/ids.js';

describe('branded ids', () => {
  it('mints sortable ULIDs', () => {
    const minted = Array.from({ length: 200 }, () => newOrderId());

    expect(minted[0]).toHaveLength(26);
    expect(orderId(minted[0]!)).toBe(minted[0]);

    // ULIDs sort by creation time, which is what makes AP8 work with nothing but
    // ScanIndexForward=false. These are all minted inside the same millisecond, so a non-monotonic
    // generator would fail here: its random low bits sort in random order.
    expect([...minted].sort()).toEqual(minted);
    expect(new Set(minted).size).toBe(minted.length);
  });

  it('rejects ids that are not ULIDs', () => {
    for (const bad of ['', 'nope', '01J0ORD', 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ', 'a'.repeat(26)]) {
      expect(() => customerId(bad), bad).toThrow('Not a valid customer id');
    }
  });

  it('constrains skus and category ids to key-safe shapes', () => {
    expect(sku('TEE-M-BLK')).toBe('TEE-M-BLK');
    expect(categoryId('tees')).toBe('tees');

    expect(() => sku('tee m blk')).toThrow('Not a valid sku');
    expect(() => categoryId('Tees')).toThrow('Not a valid category id');
  });

  it('lowercases emails before they become keys', () => {
    expect(normalizeEmail('  Buyer@Example.COM ')).toBe('buyer@example.com');
  });
});
