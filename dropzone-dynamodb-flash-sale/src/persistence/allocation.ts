/**
 * The stock allocation machinery, shared by checkout (AP7) and holds (AP15).
 *
 * Both paths write the same conditional decrement against the same buckets, and both have to read a
 * cancelled transaction's reasons the same way. One copy means the two cannot drift, and it is also
 * what lets the load harness in test/load exercise the code the handlers run instead of a
 * reimplementation of it.
 *
 * Every transaction built on top of this puts its idempotency item first and its stock updates
 * next, because that is the layout the cancellation positions below assume.
 */

import type { Sku } from '../domain/ids.js';
import type { Allocation, OrderLine } from '../domain/order.js';
import { bucketOrder } from '../domain/stock.js';
import { NotFoundError, SoldOutError } from '../shared/errors.js';
import { MetricName, count } from '../shared/metrics.js';
import type { catalogRepository } from './repositories/catalog.js';

/** What a client asked for: a sku and a quantity, with no price and no bucket yet. */
export type RequestedLine = {
  readonly sku: Sku;
  readonly qty: number;
};

/** A requested line priced from the catalog, with the bucket count it may allocate from. */
export type PricedLine = {
  readonly line: OrderLine;
  readonly buckets: number;
};

/** Spec section 7: three attempts in total for transaction conflicts. */
export const MAX_CONFLICT_ATTEMPTS = 3;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const jitteredBackoffMs = (attempt: number): number =>
  2 ** attempt * 25 * (0.5 + Math.random());

type CancellationReason = { readonly Code?: string };

export const isTransactionCancelled = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TransactionCanceledException';

/**
 * Cancellation reasons come back as one entry per transaction item, in the order the items were
 * sent. Reading them by position is the only way to know which condition failed, which is why the
 * positions are computed explicitly rather than assumed.
 */
export const cancellationReasons = (error: unknown): readonly CancellationReason[] =>
  (error as { CancellationReasons?: CancellationReason[] }).CancellationReasons ?? [];

export const CONDITION_FAILED = 'ConditionalCheckFailed';
const TRANSACTION_CONFLICT = 'TransactionConflict';

/** Where each kind of item sits in the transaction, so a cancellation reason can be read by index. */
export const IDEMPOTENCY_POSITION = 0;
export const FIRST_STOCK_POSITION = 1;

/**
 * What a cancelled transaction means for this request.
 *
 * DynamoDB reports one reason per transaction item, in the order the items were sent, and says
 * nothing about which business rule that was. Turning positions into a verdict is the whole trick,
 * and keeping it in one function makes it testable and readable.
 */
export type Verdict =
  | { readonly kind: 'replay' }
  | { readonly kind: 'rotate'; readonly empty: readonly Allocation[] }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'unexpected' };

export function classifyCancellation(
  reasons: readonly CancellationReason[],
  allocations: readonly Allocation[],
): Verdict {
  if (reasons[IDEMPOTENCY_POSITION]?.Code === CONDITION_FAILED) {
    return { kind: 'replay' };
  }

  const empty = allocations.filter(
    (_, index) => reasons[index + FIRST_STOCK_POSITION]?.Code === CONDITION_FAILED,
  );
  if (empty.length > 0) {
    return { kind: 'rotate', empty };
  }

  if (reasons.some((reason) => reason.Code === TRANSACTION_CONFLICT)) {
    return { kind: 'conflict' };
  }

  return { kind: 'unexpected' };
}

/** One bucket per line: the first in this request's rotation that has not already refused it. */
export function chooseBuckets(
  priced: readonly PricedLine[],
  exhausted: ReadonlyMap<Sku, ReadonlySet<number>>,
): Allocation[] {
  return priced.map((entry) => {
    const skipped = exhausted.get(entry.line.sku) ?? new Set<number>();
    const bucket = bucketOrder(entry.buckets).find((candidate) => !skipped.has(candidate));

    if (bucket === undefined) {
      count(MetricName.CheckoutSoldOut);
      throw new SoldOutError(entry.line.sku);
    }

    return { sku: entry.line.sku, bucket, qty: entry.line.qty };
  });
}

/** Records the buckets that refused this request, and gives up on a sku once none are left. */
export function rememberEmptyBuckets(
  empty: readonly Allocation[],
  priced: readonly PricedLine[],
  exhausted: Map<Sku, Set<number>>,
): void {
  for (const allocation of empty) {
    const skipped = exhausted.get(allocation.sku) ?? new Set<number>();
    skipped.add(allocation.bucket);
    exhausted.set(allocation.sku, skipped);

    const buckets = priced.find((entry) => entry.line.sku === allocation.sku)?.buckets ?? 1;
    if (skipped.size >= buckets) {
      count(MetricName.CheckoutSoldOut);
      throw new SoldOutError(allocation.sku);
    }
  }
}

/** How many rotations a request is allowed: one per bucket it could still try. */
export const rotationBudget = (priced: readonly PricedLine[]): number =>
  priced.reduce((total, entry) => total + entry.buckets, 0);

/**
 * Prices and bucket counts come from the catalog, never from the client (spec section 7).
 *
 * Two key lookups rather than an index query: the pointer items resolve a sku to its product, then
 * the variants carry the price to snapshot and the bucket count to allocate from.
 */
export async function priceLines(
  catalog: ReturnType<typeof catalogRepository>,
  lines: readonly RequestedLine[],
): Promise<PricedLine[]> {
  const pointers = await catalog.resolveSkus(lines.map((line) => line.sku));
  const variants = await catalog.loadVariants([...pointers.values()]);

  return lines.map((line) => {
    const pointer = pointers.get(line.sku);
    const variant = variants.get(line.sku);

    if (pointer === undefined || variant === undefined) {
      throw new NotFoundError(`No such sku: ${line.sku}`);
    }

    return {
      line: {
        sku: line.sku,
        productId: pointer.productId,
        categoryId: pointer.categoryId,
        qty: line.qty,
        unitPrice: variant.price,
      },
      buckets: variant.stockBuckets,
    };
  });
}
