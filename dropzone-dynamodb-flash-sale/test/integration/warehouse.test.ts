/**
 * AP12: the warehouse queue, on a sparse, write-sharded GSI.
 *
 * `Query GSI1PK = FULFILL#<0-9>` on all shards in parallel, merged by GSI1SK, oldest first.
 *
 * Two properties the index is built for:
 *
 * - sparse: only orders that still need fulfilment carry the keys, so shipped and cancelled orders
 *   are absent rather than filtered out
 * - sharded: ten partition key values, because every order placed during a drop writes this index,
 *   and a throttled GSI throttles writes to the base table
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { categoryId, newCustomerId, newProductId, sku } from '../../src/domain/ids.js';
import type { CustomerId, Sku } from '../../src/domain/ids.js';
import type { Order } from '../../src/domain/order.js';
import { money } from '../../src/domain/money.js';
import type { Product, Variant } from '../../src/domain/product.js';
import { SHARD_COUNTS, fulfillmentIndexPk } from '../../src/persistence/keys.js';
import { catalogRepository } from '../../src/persistence/repositories/catalog.js';
import { orderRepository } from '../../src/persistence/repositories/orders.js';
import { stockRepository } from '../../src/persistence/repositories/stock.js';
import { warehouseRepository } from '../../src/persistence/repositories/warehouse.js';
import { startHarness, type Harness } from './support/harness.js';

let harness: Harness;
let catalog: ReturnType<typeof catalogRepository>;
let orders: ReturnType<typeof orderRepository>;
let stock: ReturnType<typeof stockRepository>;
let warehouse: ReturnType<typeof warehouseRepository>;

const TEES = categoryId('tees');

const aSellableVariant = async (code: string, units: number): Promise<Sku> => {
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
    stockBuckets: 1,
  };

  await catalog.putProduct(product, [variant]);
  await stock.seed(variantSku, units, 1);

  return variantSku;
};

const placeOrder = async (customerId: CustomerId, itemSku: Sku, key: string) =>
  (
    await orders.checkout({
      customerId,
      idempotencyKey: key,
      lines: [{ sku: itemSku, qty: 1 }],
    })
  ).order;

beforeAll(async () => {
  harness = await startHarness('dropzone-test-warehouse');
  catalog = catalogRepository();
  orders = orderRepository();
  stock = stockRepository();
  warehouse = warehouseRepository();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe('AP12: unfulfilled orders, oldest first', () => {
  it('merges every shard into one queue, oldest first', async () => {
    const itemSku = await aSellableVariant('WH-A', 12);
    const placed: Order[] = [];

    // Enough orders that they certainly land in more than one shard: the shard comes from a hash
    // of the order id, so a single-shard result would mean the merge is not happening.
    for (let n = 0; n < 12; n += 1) {
      placed.push(await placeOrder(newCustomerId(), itemSku, `wh-a-${String(n)}`));
    }

    const shardsUsed = new Set(placed.map((order) => fulfillmentIndexPk(order.orderId)));
    expect(shardsUsed.size).toBeGreaterThan(1);

    const queue = await warehouse.queue({ limit: 50 });
    const queued = queue.items.filter((entry) =>
      placed.some((order) => order.orderId === entry.orderId),
    );

    // Oldest first across all shards, which is the whole job of the merge.
    expect(queued.map((entry) => entry.orderId)).toEqual(placed.map((order) => order.orderId));
    expect(queued.every((entry) => entry.status === 'PLACED')).toBe(true);
  });

  it('keeps an order in the queue while it is being picked', async () => {
    const itemSku = await aSellableVariant('WH-B', 3);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'wh-b-1');

    await orders.updateStatus(customerId, order.orderId, {
      from: 'PLACED',
      to: 'PICKING',
      expectedVersion: order.version,
    });

    const queue = await warehouse.queue({ limit: 50 });
    const entry = queue.items.find((candidate) => candidate.orderId === order.orderId);

    expect(entry?.status).toBe('PICKING');
  });

  it('drops a shipped order out of the queue', async () => {
    const itemSku = await aSellableVariant('WH-C', 3);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'wh-c-1');

    const picking = await orders.updateStatus(customerId, order.orderId, {
      from: 'PLACED',
      to: 'PICKING',
      expectedVersion: order.version,
    });
    await orders.updateStatus(customerId, order.orderId, {
      from: 'PICKING',
      to: 'SHIPPED',
      expectedVersion: picking.version,
    });

    // Not filtered out: the index keys were removed, so the entry does not exist. The order itself
    // is untouched and still readable by AP8.
    const queue = await warehouse.queue({ limit: 50 });
    expect(queue.items.map((entry) => entry.orderId)).not.toContain(order.orderId);
    expect((await orders.getOrder(customerId, order.orderId))?.status).toBe('SHIPPED');
  });

  it('drops a cancelled order out of the queue', async () => {
    const itemSku = await aSellableVariant('WH-D', 3);
    const customerId = newCustomerId();
    const order = await placeOrder(customerId, itemSku, 'wh-d-1');

    await orders.cancelOrder(customerId, order.orderId, order.version);

    const queue = await warehouse.queue({ limit: 50 });
    expect(queue.items.map((entry) => entry.orderId)).not.toContain(order.orderId);
  });

  it('queries every shard of the index', () => {
    const queried = warehouse.shardsQueried();

    expect(queried).toHaveLength(SHARD_COUNTS.fulfillment);
    expect(new Set(queried).size).toBe(SHARD_COUNTS.fulfillment);
  });

  it('respects the limit across the merged shards', async () => {
    const itemSku = await aSellableVariant('WH-E', 6);

    for (let n = 0; n < 6; n += 1) {
      await placeOrder(newCustomerId(), itemSku, `wh-e-${String(n)}`);
    }

    const queue = await warehouse.queue({ limit: 3 });

    // A limit means the whole queue, not the limit per shard.
    expect(queue.items).toHaveLength(3);
  });
});
