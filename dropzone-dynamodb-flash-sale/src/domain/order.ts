/**
 * Orders and the only rule that decides whether a status change is allowed.
 *
 * The transition table is the reason AP9 exists: the moment a customer cancels, the open-orders
 * view must stop showing that order, which is why the status index is an LSI and read strongly
 * consistent.
 */

import { InvalidTransitionError } from '../shared/errors.js';
import type { CategoryId, CustomerId, OrderId, ProductId, Sku } from './ids.js';
import type { Money } from './money.js';
import { sum, times } from './money.js';

export const ORDER_STATUSES = ['PLACED', 'PICKING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Which stock bucket a line's units came out of. Needed to put them back on a cancel. */
export type Allocation = {
  readonly sku: Sku;
  readonly bucket: number;
  readonly qty: number;
};

/** Immutable once written: the price is the one the customer agreed to. */
export type OrderLine = {
  readonly sku: Sku;
  readonly productId: ProductId;
  readonly categoryId: CategoryId;
  readonly qty: number;
  readonly unitPrice: Money;
};

export type Order = {
  readonly orderId: OrderId;
  readonly customerId: CustomerId;
  readonly status: OrderStatus;
  readonly total: Money;
  readonly placedAt: string;
  readonly updatedAt: string;
  readonly allocations: readonly Allocation[];
  /**
   * Optimistic lock counter. The domain never changes it; the repository increments it on every
   * update and uses the value it read as the update's condition (AP11).
   */
  readonly version: number;
};

/**
 * PLACED → PICKING → SHIPPED → DELIVERED, and PLACED or PICKING → CANCELLED (spec section 3).
 * Everything else throws.
 */
const ALLOWED: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PLACED: ['PICKING', 'CANCELLED'],
  PICKING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ALLOWED[from].includes(to);

/** Returns the order at its new status. Throws InvalidTransitionError if the move is not allowed. */
export function transition(order: Order, to: OrderStatus, now = new Date()): Order {
  if (!canTransition(order.status, to)) {
    throw new InvalidTransitionError(order.status, to);
  }
  return { ...order, status: to, updatedAt: now.toISOString() };
}

/**
 * Whether the warehouse still has work to do for this order.
 *
 * This is the rule behind the sparse `fulfillment-index`: the index keys are written while the
 * order needs fulfilment and removed once it does not, so the queue in AP12 contains only open
 * orders and the index stays small.
 */
export const needsFulfillment = (status: OrderStatus): boolean =>
  status === 'PLACED' || status === 'PICKING';

/** Whether cancelling should return units to their stock buckets. */
export const holdsStock = (status: OrderStatus): boolean => status !== 'CANCELLED';

export const lineTotal = (line: OrderLine): Money => times(line.unitPrice, line.qty);

export const orderTotal = (lines: readonly OrderLine[]): Money => sum(lines.map(lineTotal));
