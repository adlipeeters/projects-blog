/**
 * AP7: place an order, in one transaction.
 *
 * The three things this has to get right, from spec sections 7 and 11:
 *
 * - no oversell under concurrency, whatever the bucket layout
 * - the same Idempotency-Key twice produces one order and replays it
 * - the same key with a different body is a 422, not a surprise
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { categoryId, newCustomerId, newProductId, sku } from '../../src/domain/ids.js';
import { money } from '../../src/domain/money.js';
import type { Product, Variant } from '../../src/domain/product.js';
import { catalogRepository } from '../../src/persistence/repositories/catalog.js';
import { orderRepository } from '../../src/persistence/repositories/orders.js';
import { stockRepository } from '../../src/persistence/repositories/stock.js';
import { startHarness, type Harness } from './support/harness.js';

let harness: Harness;
let catalog: ReturnType<typeof catalogRepository>;
let orders: ReturnType<typeof orderRepository>;
let stock: ReturnType<typeof stockRepository>;

const TEES = categoryId('tees');

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
  harness = await startHarness('dropzone-test-checkout');
  catalog = catalogRepository();
  orders = orderRepository();
  stock = stockRepository();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe('AP7: checkout', () => {
  it('places an order, snapshots the price and takes the stock', async () => {
    const item = await aSellableVariant({ code: 'CHK-A', priceCents: 4999, units: 10, buckets: 1 });
    const customerId = newCustomerId();

    const result = await orders.checkout({
      customerId,
      idempotencyKey: 'key-a',
      lines: [{ sku: item.sku, qty: 2 }],
    });

    expect(result.replayed).toBe(false);
    expect(result.order.status).toBe('PLACED');
    expect(result.order.total).toEqual(money(9998));
    expect(result.order.allocations).toEqual([{ sku: item.sku, bucket: 0, qty: 2 }]);

    // The server re-prices from the catalog, so the line carries the price it charged.
    const lines = await orders.getOrderLines(result.order.orderId);
    expect(lines).toEqual([
      {
        sku: item.sku,
        productId: item.productId,
        categoryId: TEES,
        qty: 2,
        unitPrice: money(4999),
      },
    ]);

    expect(await stock.available(item.sku, 1)).toBe(8);
  });

  it('replays the original order when the same key arrives twice', async () => {
    const item = await aSellableVariant({ code: 'CHK-B', priceCents: 1999, units: 5, buckets: 1 });
    const customerId = newCustomerId();
    const request = { customerId, idempotencyKey: 'key-b', lines: [{ sku: item.sku, qty: 1 }] };

    const first = await orders.checkout(request);
    const second = await orders.checkout(request);

    expect(second.replayed).toBe(true);
    expect(second.order.orderId).toBe(first.order.orderId);

    // One order, and the stock moved once. Without the idempotency item, a retried request would
    // take a second unit and create a second order.
    expect(await stock.available(item.sku, 1)).toBe(4);
  });

  it('rejects the same key with a different body', async () => {
    const item = await aSellableVariant({ code: 'CHK-C', priceCents: 1999, units: 5, buckets: 1 });
    const customerId = newCustomerId();

    await orders.checkout({
      customerId,
      idempotencyKey: 'key-c',
      lines: [{ sku: item.sku, qty: 1 }],
    });

    await expect(
      orders.checkout({
        customerId,
        idempotencyKey: 'key-c',
        lines: [{ sku: item.sku, qty: 3 }],
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  });

  it('scopes idempotency keys to the customer', async () => {
    const item = await aSellableVariant({ code: 'CHK-D', priceCents: 1000, units: 5, buckets: 1 });

    const first = await orders.checkout({
      customerId: newCustomerId(),
      idempotencyKey: 'shared-key',
      lines: [{ sku: item.sku, qty: 1 }],
    });
    const second = await orders.checkout({
      customerId: newCustomerId(),
      idempotencyKey: 'shared-key',
      lines: [{ sku: item.sku, qty: 1 }],
    });

    // Same key, different customers: two orders. The key is part of a per-customer partition key.
    expect(second.order.orderId).not.toBe(first.order.orderId);
    expect(second.replayed).toBe(false);
  });

  it('returns 409 SOLD_OUT when every bucket is empty', async () => {
    const item = await aSellableVariant({ code: 'CHK-E', priceCents: 1000, units: 1, buckets: 1 });

    await orders.checkout({
      customerId: newCustomerId(),
      idempotencyKey: 'key-e1',
      lines: [{ sku: item.sku, qty: 1 }],
    });

    await expect(
      orders.checkout({
        customerId: newCustomerId(),
        idempotencyKey: 'key-e2',
        lines: [{ sku: item.sku, qty: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'SOLD_OUT', details: { sku: item.sku } });

    expect(await stock.available(item.sku, 1)).toBe(0);
  });

  it('refuses a line for a sku that is not in the catalog', async () => {
    await expect(
      orders.checkout({
        customerId: newCustomerId(),
        idempotencyKey: 'key-f',
        lines: [{ sku: sku('NOT-A-SKU'), qty: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never oversells under concurrency (spec section 11)', async () => {
    const units = 10;
    const buckets = 2;
    const attempts = 50;
    const item = await aSellableVariant({ code: 'CHK-RACE', priceCents: 1000, units, buckets });

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, n) =>
        orders.checkout({
          customerId: newCustomerId(),
          idempotencyKey: `race-${String(n)}`,
          lines: [{ sku: item.sku, qty: 1 }],
        }),
      ),
    );

    const placed = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');

    // Exactly the units that existed, no more and no fewer.
    expect(placed).toHaveLength(units);
    expect(await stock.available(item.sku, buckets)).toBe(0);

    // Everything else was refused for the documented reason: sold out, or conflicts that outlived
    // the retry budget. Never an unexpected error, and never a successful oversell.
    for (const result of refused) {
      expect(result.reason).toMatchObject({
        code: expect.stringMatching(/^(SOLD_OUT|CONFLICT)$/),
      });
    }

    // The invariant from section 9: available + sold = initial.
    const sold = placed.length;
    expect((await stock.available(item.sku, buckets)) + sold).toBe(units);
  });
});
