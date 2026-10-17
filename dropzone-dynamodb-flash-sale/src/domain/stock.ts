/**
 * Stock allocation across buckets.
 *
 * One stock item per SKU means every checkout for a drop writes the same item, so all traffic lands
 * on one partition: a single partition serves at most 1,000 write units per second, and a
 * transactional write costs 2 units per item, but concurrent transactions touching the same item
 * fail with TransactionConflict long before that ceiling (spec section 9).
 *
 * The fix is to split the stock into buckets. This file holds the part that is pure: which bucket to
 * try, and in what order. The retry loop that uses it lives in the repository.
 */

/**
 * The order in which a request walks the buckets of one SKU: a random start, then the rest in
 * rotation.
 *
 * Random, not hashed, because the point is to spread concurrent requests across buckets. The
 * consequence is that the chosen bucket cannot be recomputed later, so it is recorded in the
 * order's allocations.
 */
export function bucketOrder(bucketCount: number, random: () => number = Math.random): number[] {
  if (!Number.isInteger(bucketCount) || bucketCount < 1) {
    throw new Error(`Bucket count must be a positive integer, got ${String(bucketCount)}`);
  }

  const start = Math.floor(random() * bucketCount) % bucketCount;
  return Array.from({ length: bucketCount }, (_, offset) => (start + offset) % bucketCount);
}

/**
 * The invariant checked after every load run (spec section 9): available units, plus units sold,
 * plus units held, must equal what was seeded. Any difference fails the run.
 */
export const stockIsConserved = (input: {
  readonly initial: number;
  readonly available: number;
  readonly inOrders: number;
  readonly inHolds: number;
}): boolean => input.available + input.inOrders + input.inHolds === input.initial;
