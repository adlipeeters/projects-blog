/**
 * AP15: hold stock, then confirm or release it.
 *
 * The properties that matter, from spec sections 7 and 11:
 *
 * - the units leave `available` when the hold is created, so a reservation is real
 * - confirm and release can never both succeed on the same hold, however they race
 * - a confirm after `expiresAt` is refused, because the timer is a condition and not TTL
 * - releasing returns every unit to the bucket it came from
 * - the sweeper releases expired holds and leaves unexpired ones alone
 */

import type { Context } from 'aws-lambda';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HOLD_TTL_MINUTES } from '../../src/domain/hold.js';
import { categoryId, newCustomerId, newHoldId, newProductId, sku } from '../../src/domain/ids.js';
import { money } from '../../src/domain/money.js';
import type { Product, Variant } from '../../src/domain/product.js';
import { handler as sweepHolds } from '../../src/handlers/scheduled/hold-sweeper.js';
import { catalogRepository } from '../../src/persistence/repositories/catalog.js';
import { holdRepository } from '../../src/persistence/repositories/holds.js';
import { orderRepository } from '../../src/persistence/repositories/orders.js';
import { stockRepository } from '../../src/persistence/repositories/stock.js';
import { startHarness, type Harness } from './support/harness.js';

let harness: Harness;
let catalog: ReturnType<typeof catalogRepository>;
let holds: ReturnType<typeof holdRepository>;
let orders: ReturnType<typeof orderRepository>;
let stock: ReturnType<typeof stockRepository>;

const TEES = categoryId('tees');

/** The sweeper is a plain function; EventBridge Scheduler only supplies the request id. */
const aContext = (): Context => ({ awsRequestId: 'test-sweep' }) as unknown as Context;

/** A time far enough in the past that any hold taken at it has already expired. */
const longExpired = (): Date => new Date(Date.now() - (HOLD_TTL_MINUTES + 5) * 60_000);

/** Puts a product with one variant in the catalog, and its stock in the commerce table. */
const aSellableVariant = async (input: {
  code: string;
  priceCents: number;
  units: number;
  buckets: number;
}) => {
  const productId = newProductId();
  const variantSku = sku(input.code);

  const product: Product = {
    productId,
    name: `Product ${input.code}`,
    description: 'For sale.',
    categoryId: TEES,
    fromPrice: money(input.priceCents),
    imageUrl: 'https://example.test/p.jpg',
    isDrop: input.buckets > 1,
  };

  const variant: Variant = {
    productId,
    sku: variantSku,
    size: 'M',
    color: 'BLK',
    price: money(input.priceCents),
    stockBuckets: input.buckets,
  };

  await catalog.putProduct(product, [variant]);
  await stock.seed(variantSku, input.units, input.buckets);

  return { productId, sku: variantSku };
};

beforeAll(async () => {
  harness = await startHarness('dropzone-test-holds');
  catalog = catalogRepository();
  holds = holdRepository();
  orders = orderRepository();
  stock = stockRepository();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe('AP15: create a hold', () => {
  it('takes the units out of the bucket straight away', async () => {
    const item = await aSellableVariant({ code: 'HLD-A', priceCents: 2199, units: 10, buckets: 1 });
    const customerId = newCustomerId();

    const result = await holds.createHold({
      customerId,
      idempotencyKey: 'hold-a',
      lines: [{ sku: item.sku, qty: 2 }],
    });

    expect(result.replayed).toBe(false);
    expect(result.hold.status).toBe('HELD');
    expect(result.hold.allocations).toEqual([{ sku: item.sku, bucket: 0, qty: 2 }]);

    // The price the shopper was quoted, snapshotted so confirming needs no catalog read.
    expect(result.hold.lines).toEqual([
      {
        sku: item.sku,
        productId: item.productId,
        categoryId: TEES,
        qty: 2,
        unitPrice: money(2199),
      },
    ]);

    // Gone from available now, not at confirm time. This is what makes the reservation real.
    expect(await stock.available(item.sku, 1)).toBe(8);
  });

  it('replays the original hold when the same key arrives twice', async () => {
    const item = await aSellableVariant({ code: 'HLD-B', priceCents: 1999, units: 5, buckets: 1 });
    const request = {
      customerId: newCustomerId(),
      idempotencyKey: 'hold-b',
      lines: [{ sku: item.sku, qty: 1 }],
    };

    const first = await holds.createHold(request);
    const second = await holds.createHold(request);

    expect(second.replayed).toBe(true);
    expect(second.hold.holdId).toBe(first.hold.holdId);

    // One hold, and the stock moved once.
    expect(await stock.available(item.sku, 1)).toBe(4);
  });

  it('returns 409 SOLD_OUT when every bucket is empty', async () => {
    const item = await aSellableVariant({ code: 'HLD-C', priceCents: 1000, units: 1, buckets: 1 });

    await holds.createHold({
      customerId: newCustomerId(),
      idempotencyKey: 'hold-c1',
      lines: [{ sku: item.sku, qty: 1 }],
    });

    await expect(
      holds.createHold({
        customerId: newCustomerId(),
        idempotencyKey: 'hold-c2',
        lines: [{ sku: item.sku, qty: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'SOLD_OUT', details: { sku: item.sku } });
  });
});

describe('AP15: confirm a hold', () => {
  it('turns the hold into an order without touching the stock again', async () => {
    const item = await aSellableVariant({ code: 'CFM-A', priceCents: 2199, units: 10, buckets: 1 });
    const customerId = newCustomerId();

    const held = await holds.createHold({
      customerId,
      idempotencyKey: 'confirm-a',
      lines: [{ sku: item.sku, qty: 3 }],
    });
    const afterHold = await stock.available(item.sku, 1);

    const confirmed = await holds.confirmHold(customerId, held.hold.holdId);

    expect(confirmed.replayed).toBe(false);
    expect(confirmed.order.status).toBe('PLACED');
    expect(confirmed.order.total).toEqual(money(2199 * 3));
    expect(confirmed.order.allocations).toEqual(held.hold.allocations);

    // The lines came from the hold's snapshot, so the order is priced as it was quoted.
    const lines = await orders.getOrderLines(confirmed.order.orderId);
    expect(lines).toEqual(held.hold.lines);

    // Confirming is bookkeeping: the units left at create time and do not leave twice.
    expect(await stock.available(item.sku, 1)).toBe(afterHold);

    const hold = await holds.getHold(customerId, held.hold.holdId);
    expect(hold?.status).toBe('CONFIRMED');
  });

  it('replays the same order when the hold is confirmed twice', async () => {
    const item = await aSellableVariant({ code: 'CFM-B', priceCents: 1500, units: 5, buckets: 1 });
    const customerId = newCustomerId();

    const held = await holds.createHold({
      customerId,
      idempotencyKey: 'confirm-b',
      lines: [{ sku: item.sku, qty: 1 }],
    });

    const first = await holds.confirmHold(customerId, held.hold.holdId);
    const second = await holds.confirmHold(customerId, held.hold.holdId);

    expect(second.replayed).toBe(true);
    expect(second.order.orderId).toBe(first.order.orderId);
    expect(await stock.available(item.sku, 1)).toBe(4);
  });

  it('refuses to confirm after expiresAt, with a 410', async () => {
    const item = await aSellableVariant({ code: 'CFM-C', priceCents: 1500, units: 5, buckets: 1 });
    const customerId = newCustomerId();

    // Taken in the past, so its ten minutes are already over. The item is still there: TTL deletes
    // within days, which is exactly why the condition does the work.
    const held = await holds.createHold(
      { customerId, idempotencyKey: 'confirm-c', lines: [{ sku: item.sku, qty: 1 }] },
      longExpired(),
    );

    await expect(holds.confirmHold(customerId, held.hold.holdId)).rejects.toMatchObject({
      code: 'HOLD_EXPIRED',
      httpStatus: 410,
    });

    expect(await holds.getHold(customerId, held.hold.holdId)).toMatchObject({ status: 'HELD' });
  });

  it('is a 404 when there is no such hold', async () => {
    await expect(holds.confirmHold(newCustomerId(), newHoldId())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('AP15: release a hold', () => {
  it('returns every unit to the bucket it came from', async () => {
    const item = await aSellableVariant({ code: 'REL-A', priceCents: 1000, units: 10, buckets: 4 });
    const customerId = newCustomerId();

    const before = await stock.readBuckets(item.sku, 4);
    const held = await holds.createHold({
      customerId,
      idempotencyKey: 'release-a',
      lines: [{ sku: item.sku, qty: 2 }],
    });

    const outcome = await holds.releaseHold(customerId, held.hold.holdId);

    expect(outcome.kind).toBe('released');
    expect(await stock.readBuckets(item.sku, 4)).toEqual(
      before.map((bucket) => ({
        ...bucket,
        // Two writes touched the bucket the units came from, so only its version moved.
        version:
          bucket.bucket === held.hold.allocations[0]?.bucket ? bucket.version + 2 : bucket.version,
      })),
    );
  });

  it('reports already-resolved when the hold was confirmed first', async () => {
    const item = await aSellableVariant({ code: 'REL-B', priceCents: 1000, units: 5, buckets: 1 });
    const customerId = newCustomerId();

    const held = await holds.createHold({
      customerId,
      idempotencyKey: 'release-b',
      lines: [{ sku: item.sku, qty: 1 }],
    });
    await holds.confirmHold(customerId, held.hold.holdId);

    expect(await holds.releaseHold(customerId, held.hold.holdId)).toEqual({
      kind: 'already-resolved',
    });

    // The confirmed order keeps its unit: a late release must not hand it back.
    expect(await stock.available(item.sku, 1)).toBe(4);
  });

  it('lets exactly one of confirm and release win, every time', async () => {
    const attempts = 20;
    const item = await aSellableVariant({
      code: 'REL-RACE',
      priceCents: 1000,
      units: attempts,
      buckets: 1,
    });

    let confirmedCount = 0;

    for (let n = 0; n < attempts; n += 1) {
      const customerId = newCustomerId();
      const held = await holds.createHold({
        customerId,
        idempotencyKey: `release-race-${String(n)}`,
        lines: [{ sku: item.sku, qty: 1 }],
      });

      const [confirm, release] = await Promise.allSettled([
        holds.confirmHold(customerId, held.hold.holdId),
        holds.releaseHold(customerId, held.hold.holdId),
      ]);

      const confirmed = confirm?.status === 'fulfilled';
      const released = release?.status === 'fulfilled' && release.value.kind === 'released';

      // Both conditions require `status = HELD`, so the database decides and one of them loses.
      expect(confirmed).not.toBe(released);

      const hold = await holds.getHold(customerId, held.hold.holdId);
      expect(hold?.status).toBe(confirmed ? 'CONFIRMED' : 'RELEASED');

      if (confirmed) {
        confirmedCount += 1;
      }
    }

    // Every unit either sits in a confirmed order or is back in the bucket. Nothing evaporated,
    // and nothing was counted twice.
    expect(await stock.available(item.sku, 1)).toBe(attempts - confirmedCount);
  }, 60_000);
});

describe('AP15: the sweeper', () => {
  it('finds expired holds through the index and releases them', async () => {
    const item = await aSellableVariant({ code: 'SWP-A', priceCents: 1000, units: 5, buckets: 1 });
    const customerId = newCustomerId();

    const held = await holds.createHold(
      { customerId, idempotencyKey: 'sweep-a', lines: [{ sku: item.sku, qty: 2 }] },
      longExpired(),
    );
    expect(await stock.available(item.sku, 1)).toBe(3);

    const expired = await holds.expiredHolds();
    expect(expired.shards).toBe(4);
    expect(expired.items.map((entry) => entry.holdId)).toContain(held.hold.holdId);

    const report = await sweepHolds({}, aContext());

    expect(report.released).toBeGreaterThanOrEqual(1);
    expect(report.failed).toBe(0);
    expect(await holds.getHold(customerId, held.hold.holdId)).toMatchObject({
      status: 'RELEASED',
    });

    // The units are back on sale about a minute after expiry, not whenever TTL gets round to it.
    expect(await stock.available(item.sku, 1)).toBe(5);
  }, 30_000);

  it('leaves a hold that has not expired alone', async () => {
    const item = await aSellableVariant({ code: 'SWP-B', priceCents: 1000, units: 5, buckets: 1 });
    const customerId = newCustomerId();

    const held = await holds.createHold({
      customerId,
      idempotencyKey: 'sweep-b',
      lines: [{ sku: item.sku, qty: 1 }],
    });

    // Not in the sweeper's query: its sort key starts with expiresAt, which is in the future.
    const expired = await holds.expiredHolds();
    expect(expired.items.map((entry) => entry.holdId)).not.toContain(held.hold.holdId);

    // And even asked directly, the expiredOnly condition refuses.
    expect(await holds.releaseHold(customerId, held.hold.holdId, { expiredOnly: true })).toEqual({
      kind: 'already-resolved',
    });

    expect(await stock.available(item.sku, 1)).toBe(4);
    expect(await holds.getHold(customerId, held.hold.holdId)).toMatchObject({ status: 'HELD' });
  }, 30_000);

  it('drops a confirmed hold out of the index entirely', async () => {
    const item = await aSellableVariant({ code: 'SWP-C', priceCents: 1000, units: 5, buckets: 1 });
    const customerId = newCustomerId();

    const held = await holds.createHold({
      customerId,
      idempotencyKey: 'sweep-c',
      lines: [{ sku: item.sku, qty: 1 }],
    });
    await holds.confirmHold(customerId, held.hold.holdId);

    // Sparse: the index keys were removed, so the sweeper reads nothing it has to discard.
    const expired = await holds.expiredHolds(new Date(Date.now() + 60 * 60_000));
    expect(expired.items.map((entry) => entry.holdId)).not.toContain(held.hold.holdId);
  }, 30_000);
});

describe('AP15 under concurrency', () => {
  it('never holds more units than exist', async () => {
    const units = 10;
    const buckets = 2;
    const attempts = 50;
    const item = await aSellableVariant({ code: 'HLD-RACE', priceCents: 1000, units, buckets });

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, n) =>
        holds.createHold({
          customerId: newCustomerId(),
          idempotencyKey: `hold-race-${String(n)}`,
          lines: [{ sku: item.sku, qty: 1 }],
        }),
      ),
    );

    const taken = results.filter((result) => result.status === 'fulfilled');

    expect(taken).toHaveLength(units);
    expect(await stock.available(item.sku, buckets)).toBe(0);

    for (const result of results.filter((r) => r.status === 'rejected')) {
      expect(result.reason).toMatchObject({
        code: expect.stringMatching(/^(SOLD_OUT|CONFLICT)$/),
      });
    }

    // The invariant from section 9, with holds in it: available + held = initial.
    expect((await stock.available(item.sku, buckets)) + taken.length).toBe(units);
  }, 60_000);
});
