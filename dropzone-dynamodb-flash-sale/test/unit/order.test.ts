import { describe, expect, it } from 'vitest';

import { money } from '../../src/domain/money.js';
import {
  ORDER_STATUSES,
  canTransition,
  needsFulfillment,
  orderTotal,
  transition,
} from '../../src/domain/order.js';
import type { Order, OrderLine, OrderStatus } from '../../src/domain/order.js';
import { categoryId, newCustomerId, newOrderId, newProductId, sku } from '../../src/domain/ids.js';

const anOrder = (status: OrderStatus): Order => ({
  orderId: newOrderId(),
  customerId: newCustomerId(),
  status,
  total: money(4999),
  placedAt: '2026-10-15T12:00:00.000Z',
  updatedAt: '2026-10-15T12:00:00.000Z',
  allocations: [],
  version: 1,
});

const aLine = (unitPriceCents: number, qty: number): OrderLine => ({
  sku: sku('TEE-M-BLK'),
  productId: newProductId(),
  categoryId: categoryId('tees'),
  qty,
  unitPrice: money(unitPriceCents),
});

describe('order status transitions (spec section 3)', () => {
  it('allows exactly the documented moves', () => {
    const allowed: ReadonlyArray<readonly [OrderStatus, OrderStatus]> = [
      ['PLACED', 'PICKING'],
      ['PICKING', 'SHIPPED'],
      ['SHIPPED', 'DELIVERED'],
      ['PLACED', 'CANCELLED'],
      ['PICKING', 'CANCELLED'],
    ];

    for (const [from, to] of allowed) {
      expect(canTransition(from, to), `${from} to ${to}`).toBe(true);
    }

    // Everything else is refused, including every move out of a terminal status and every
    // same-status no-op.
    const allowedKeys = new Set(allowed.map(([from, to]) => `${from}>${to}`));
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (!allowedKeys.has(`${from}>${to}`)) {
          expect(canTransition(from, to), `${from} to ${to}`).toBe(false);
        }
      }
    }
  });

  it('returns the order at its new status and stamps updatedAt', () => {
    const placed = anOrder('PLACED');
    const picking = transition(placed, 'PICKING', new Date('2026-10-15T13:00:00.000Z'));

    expect(picking.status).toBe('PICKING');
    expect(picking.updatedAt).toBe('2026-10-15T13:00:00.000Z');
    expect(picking.orderId).toBe(placed.orderId);

    // The original is untouched, and the lock counter belongs to the repository, not the domain.
    expect(placed.status).toBe('PLACED');
    expect(picking.version).toBe(placed.version);
  });

  it('refuses a disallowed move with the from and to statuses', () => {
    expect(() => transition(anOrder('DELIVERED'), 'PICKING')).toThrow(
      'order status change is not allowed',
    );

    try {
      transition(anOrder('CANCELLED'), 'SHIPPED');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { details: Record<string, unknown> }).details).toEqual({
        from: 'CANCELLED',
        to: 'SHIPPED',
      });
    }
  });

  it('keeps only open orders in the fulfillment queue', () => {
    // This is the rule the sparse fulfillment-index implements: keys written while true, removed
    // once false, so AP12 never sees a shipped or cancelled order.
    expect(needsFulfillment('PLACED')).toBe(true);
    expect(needsFulfillment('PICKING')).toBe(true);
    expect(needsFulfillment('SHIPPED')).toBe(false);
    expect(needsFulfillment('DELIVERED')).toBe(false);
    expect(needsFulfillment('CANCELLED')).toBe(false);
  });

  it('totals lines at their snapshotted prices', () => {
    expect(orderTotal([aLine(4999, 2), aLine(1500, 1)]).amountCents).toBe(11498);
    expect(orderTotal([]).amountCents).toBe(0);
  });
});
