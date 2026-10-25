import { describe, expect, it } from 'vitest';

import { HOLD_TTL_MINUTES, holdExpiry, isConfirmable, isExpired } from '../../src/domain/hold.js';
import type { Hold } from '../../src/domain/hold.js';
import { categoryId, customerId, holdId, productId, sku } from '../../src/domain/ids.js';
import { money } from '../../src/domain/money.js';
import { holdToItem } from '../../src/persistence/mappers/hold.js';

const CUSTOMER = customerId('01JC0000000000000000000000');
const HOLD = holdId('01JH0000000000000000000000');

const aHold = (overrides: Partial<Hold> = {}): Hold => ({
  holdId: HOLD,
  customerId: CUSTOMER,
  status: 'HELD',
  expiresAt: '2026-10-25T12:10:00.000Z',
  allocations: [{ sku: sku('DROP-TEE-M-BLK'), bucket: 7, qty: 1 }],
  lines: [
    {
      sku: sku('DROP-TEE-M-BLK'),
      productId: productId('01JP0000000000000000000000'),
      categoryId: categoryId('tees'),
      qty: 1,
      unitPrice: money(2199),
    },
  ],
  createdAt: '2026-10-25T12:00:00.000Z',
  version: 1,
  ...overrides,
});

describe('hold expiry', () => {
  it('expires ten minutes after it was taken', () => {
    expect(holdExpiry(new Date('2026-10-25T12:00:00.000Z'))).toBe('2026-10-25T12:10:00.000Z');
    expect(HOLD_TTL_MINUTES).toBe(10);
  });

  it('is expired at its expiry instant, not a millisecond later', () => {
    const hold = aHold();

    expect(isExpired(hold, new Date('2026-10-25T12:09:59.999Z'))).toBe(false);
    expect(isExpired(hold, new Date('2026-10-25T12:10:00.000Z'))).toBe(true);
  });

  it('is confirmable only while it is HELD and unexpired', () => {
    const before = new Date('2026-10-25T12:05:00.000Z');
    const after = new Date('2026-10-25T12:30:00.000Z');

    expect(isConfirmable(aHold(), before)).toBe(true);
    expect(isConfirmable(aHold(), after)).toBe(false);
    expect(isConfirmable(aHold({ status: 'CONFIRMED' }), before)).toBe(false);
    expect(isConfirmable(aHold({ status: 'RELEASED' }), before)).toBe(false);
  });
});

/**
 * The property the whole sweeper depends on: the index holds open work only. A confirmed hold is
 * absent from `holds-index` because its keys are gone, not because a query filtered it out.
 */
describe('holds-index sparseness', () => {
  it('carries the index keys while the hold is HELD', () => {
    const item = holdToItem(aHold());

    expect(item['GSI3PK']).toBe('HOLDS#0');
    expect(item['GSI3SK']).toBe('2026-10-25T12:10:00.000Z#01JH0000000000000000000000');
  });

  it('carries none once the hold is confirmed or released', () => {
    for (const status of ['CONFIRMED', 'RELEASED'] as const) {
      const item = holdToItem(aHold({ status }));

      expect(item).not.toHaveProperty('GSI3PK');
      expect(item).not.toHaveProperty('GSI3SK');
    }
  });

  it('sets ttl a day after expiry, because TTL is cleanup and not the timer', () => {
    const item = holdToItem(aHold());
    const expiry = Date.parse('2026-10-25T12:10:00.000Z') / 1000;

    expect(item['ttl']).toBe(expiry + 24 * 60 * 60);
  });
});
