/**
 * AP8 to AP11 against DynamoDB Local.
 *
 * | AP   | Access pattern                                   | Operation                                  |
 * | ---- | ------------------------------------------------ | ------------------------------------------ |
 * | AP8  | A customer's orders, newest first                 | Query PK, begins_with(SK, ORDER#), reversed |
 * | AP9  | A customer's orders with a given status            | Query the LSI, strongly consistent          |
 * | AP10 | An order's line items                              | Query PK = ORDER#<orderId>                  |
 * | AP11 | Change an order's status                           | UpdateItem, conditional on status + version |
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { categoryId, newCustomerId, newProductId, sku } from '../../src/domain/ids.js';
import type { CustomerId } from '../../src/domain/ids.js';
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

const aSellableVariant = async (code: string, units: number, buckets = 1) => {
  const productId = newProductId();
  const variantSku = sku(code);

  const product: Product = {
    productId,
    name: `Product ${code}`,
    description: 'For sale.',
    categoryId: TEES,
    fromPrice: money(1000),
    imageUrl: 'https://example.test/p.jpg',
    isDrop: false,
  };

  const variant: Variant = {
    productId,
    sku: variantSku,
    size: 'M',
    color: 'BLK',
    price: money(1000),
    stockBuckets: buckets,
  };

  await catalog.putProduct(product, [variant]);
  await stock.seed(variantSku, units, buckets);

  return variantSku;
};

const placeOrder = async (customerId: CustomerId, itemSku: ReturnType<typeof sku>, key: string) => {
  const result = await orders.checkout({
    customerId,
    idempotencyKey: key,
    lines: [{ sku: itemSku, qty: 1 }],
  });
  return result.order;
};

beforeAll(async () => {
  harness = await startHarness('dropzone-test-orders');
  catalog = catalogRepository();
  orders = orderRepository();
  stock = stockRepository();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe('AP8: a customer orders, newest first', () => {
  it('returns orders newest first, and nothing from another customer', async () => {
    const itemSku = await aSellableVariant('ORD-A', 10);
    const customerId = newCustomerId();
    const other = newCustomerId();

    const first = await placeOrder(customerId, itemSku, 'ap8-1');
    const second = await placeOrder(customerId, itemSku, 'ap8-2');
    const third = await placeOrder(customerId, itemSku, 'ap8-3');
    await placeOrder(other, itemSku, 'ap8-other');

    const page = await orders.listOrders({ customerId });

    // ULIDs sort by creation time and the sort key is ORDER#<ulid>, so reversing the query is all
    // the ordering this needs: no timestamp in the key, no sorting in the Lambda.
    expect(page.items.map((order) => order.orderId)).toEqual([
      third.orderId,
      second.orderId,
      first.orderId,
    ]);
  });

  it('pages with a cursor', async () => {
    const itemSku = await aSellableVariant('ORD-B', 10);
    const customerId = newCustomerId();

    await placeOrder(customerId, itemSku, 'ap8b-1');
    await placeOrder(customerId, itemSku, 'ap8b-2');
    await placeOrder(customerId, itemSku, 'ap8b-3');

    const first = await orders.listOrders({ customerId, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.cursor).not.toBeNull();

    const second = await orders.listOrders({
      customerId,
      limit: 2,
      ...(first.cursor === null ? {} : { cursor: first.cursor }),
    });

    expect(second.items).toHaveLength(1);
    expect(second.cursor).toBeNull();
  });
});

describe('AP9: a customer orders by status, on the LSI', () => {
  it('reflects a cancellation immediately, which is why this is an LSI', async () => {
    const itemSku = await aSellableVariant('ORD-C', 10);
    const customerId = newCustomerId();

    const keep = await placeOrder(customerId, itemSku, 'ap9-keep');
    const cancel = await placeOrder(customerId, itemSku, 'ap9-cancel');

    expect((await orders.listOrders({ customerId, status: 'PLACED' })).items).toHaveLength(2);

    await orders.cancelOrder(customerId, cancel.orderId, cancel.version);

    // No sleep, no retry: the read that follows a write has to see it. A GSI could not promise
    // this, which is the entire reason customer-status-index is a local secondary index.
    const open = await orders.listOrders({ customerId, status: 'PLACED' });
    expect(open.items.map((order) => order.orderId)).toEqual([keep.orderId]);

    const cancelled = await orders.listOrders({ customerId, status: 'CANCELLED' });
    expect(cancelled.items.map((order) => order.orderId)).toEqual([cancel.orderId]);
  });

  it('returns an empty page for a status with no orders', async () => {
    const customerId = newCustomerId();

    expect((await orders.listOrders({ customerId, status: 'DELIVERED' })).items).toEqual([]);
  });
});

describe('AP10: an order line items', () => {
  it('returns the lines with their snapshotted prices', async () => {
    const itemSku = await aSellableVariant('ORD-D', 5);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'ap10-1');

    const lines = await orders.getOrderLines(order.orderId);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.sku).toBe(itemSku);
    expect(lines[0]?.unitPrice).toEqual(money(1000));
  });
});

describe('AP11: change an order status', () => {
  it('walks the allowed path and bumps the version each time', async () => {
    const itemSku = await aSellableVariant('ORD-E', 5);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'ap11-1');

    const picking = await orders.updateStatus(customerId, order.orderId, {
      from: 'PLACED',
      to: 'PICKING',
      expectedVersion: order.version,
    });
    expect(picking.status).toBe('PICKING');
    expect(picking.version).toBe(order.version + 1);

    const shipped = await orders.updateStatus(customerId, order.orderId, {
      from: 'PICKING',
      to: 'SHIPPED',
      expectedVersion: picking.version,
    });
    expect(shipped.status).toBe('SHIPPED');

    const delivered = await orders.updateStatus(customerId, order.orderId, {
      from: 'SHIPPED',
      to: 'DELIVERED',
      expectedVersion: shipped.version,
    });
    expect(delivered.status).toBe('DELIVERED');
  });

  it('refuses a transition the domain does not allow', async () => {
    const itemSku = await aSellableVariant('ORD-F', 5);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'ap11-2');

    await expect(
      orders.updateStatus(customerId, order.orderId, {
        from: 'PLACED',
        to: 'DELIVERED',
        expectedVersion: order.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('refuses a stale version, so two updates cannot both win', async () => {
    const itemSku = await aSellableVariant('ORD-G', 5);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'ap11-3');

    await orders.updateStatus(customerId, order.orderId, {
      from: 'PLACED',
      to: 'PICKING',
      expectedVersion: order.version,
    });

    // Someone else moved it on in the meantime, so this caller's view is out of date.
    await expect(
      orders.updateStatus(customerId, order.orderId, {
        from: 'PLACED',
        to: 'CANCELLED',
        expectedVersion: order.version,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('returns the units to their own buckets when an order is cancelled', async () => {
    const itemSku = await aSellableVariant('ORD-H', 6, 3);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'ap11-4');

    const bucket = order.allocations[0]?.bucket;
    expect(bucket).toBeTypeOf('number');
    const before = await stock.readBuckets(itemSku, 3);
    expect(await stock.available(itemSku, 3)).toBe(5);

    const cancelled = await orders.cancelOrder(customerId, order.orderId, order.version);
    expect(cancelled.status).toBe('CANCELLED');

    // Back to six, and back into the bucket it came from: allocations record which one, because
    // the writer picked it at random and nothing can recompute it.
    expect(await stock.available(itemSku, 3)).toBe(6);
    const after = await stock.readBuckets(itemSku, 3);
    for (const [index, bucketAfter] of after.entries()) {
      const expected = (before[index]?.available ?? 0) + (bucketAfter.bucket === bucket ? 1 : 0);
      expect(bucketAfter.available, `bucket ${String(bucketAfter.bucket)}`).toBe(expected);
    }
  });

  it('refuses to cancel an order that has shipped', async () => {
    const itemSku = await aSellableVariant('ORD-I', 5);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'ap11-5');

    const picking = await orders.updateStatus(customerId, order.orderId, {
      from: 'PLACED',
      to: 'PICKING',
      expectedVersion: order.version,
    });
    const shipped = await orders.updateStatus(customerId, order.orderId, {
      from: 'PICKING',
      to: 'SHIPPED',
      expectedVersion: picking.version,
    });

    await expect(
      orders.cancelOrder(customerId, order.orderId, shipped.version),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    // And the stock stayed where it was: a shipped order does not give units back.
    expect(await stock.available(itemSku, 1)).toBe(4);
  });
});
