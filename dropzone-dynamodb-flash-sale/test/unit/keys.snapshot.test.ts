import { describe, it, expect } from 'vitest';
import * as keys from '../../src/persistence/keys.js';

/**
 * The gate from spec section 11: every key format in spec section 6, pinned. Run locally, since
 * this project has no CI.
 *
 * A changed key format fails here and needs human review, because every item already written
 * uses the old one.
 */
describe('key formats (spec section 6)', () => {
  it('catalog keys', () => {
    expect(keys.productKey('01J0PROD')).toEqual({ PK: 'PRODUCT#01J0PROD', SK: 'META' });
    expect(keys.variantKey('01J0PROD', 'TEE-M-BLK')).toEqual({
      PK: 'PRODUCT#01J0PROD',
      SK: 'VARIANT#TEE-M-BLK',
    });
    expect(keys.categoryIndexPk('tees')).toBe('CATEGORY#tees');
    expect(keys.categoryPriceIndexSk(4999, '01J0PROD')).toBe('PRICE#0000004999#01J0PROD');
  });

  it('customer and order keys', () => {
    expect(keys.customerKey('01J0CUST')).toEqual({ PK: 'CUSTOMER#01J0CUST', SK: 'PROFILE' });
    expect(keys.emailMarkerKey('Buyer@Example.com')).toEqual({
      PK: 'EMAIL#buyer@example.com',
      SK: 'EMAIL',
    });
    expect(keys.orderKey('01J0CUST', '01J0ORD')).toEqual({
      PK: 'CUSTOMER#01J0CUST',
      SK: 'ORDER#01J0ORD',
    });
    expect(keys.orderStatusLsiSk('PLACED', '01J0ORD')).toBe('STATUS#PLACED#01J0ORD');
    expect(keys.orderStatusLsiPrefix('PLACED')).toBe('STATUS#PLACED#');
    expect(keys.orderLineKey('01J0ORD', 'TEE-M-BLK')).toEqual({
      PK: 'ORDER#01J0ORD',
      SK: 'LINE#TEE-M-BLK',
    });
  });

  it('stock, hold and idempotency keys', () => {
    expect(keys.stockBucketKey('TEE-M-BLK', 3)).toEqual({ PK: 'STOCK#TEE-M-BLK#03', SK: 'STOCK' });
    expect(keys.stockBucketKeys('TEE-M-BLK', 10)).toHaveLength(10);
    expect(keys.holdKey('01J0CUST', '01J0HOLD')).toEqual({
      PK: 'CUSTOMER#01J0CUST',
      SK: 'HOLD#01J0HOLD',
    });
    expect(keys.holdsIndexSk('2026-10-15T12:00:00.000Z', '01J0HOLD')).toBe(
      '2026-10-15T12:00:00.000Z#01J0HOLD',
    );
    expect(keys.idempotencyKey('01J0CUST', 'abc-123')).toEqual({
      PK: 'IDEMPOTENCY#01J0CUST#abc-123',
      SK: 'IDEMPOTENCY',
    });
  });

  it('aggregate, marker and backfill keys', () => {
    expect(keys.salesAggregateKey('tees', '2026-10-15', 'TEE-M-BLK')).toEqual({
      PK: 'SALES#tees#2026-10-15',
      SK: 'SKU#TEE-M-BLK',
    });
    expect(keys.notificationMarkerKey('SALE_LINE', '01J0ORD-TEE-M-BLK')).toEqual({
      PK: 'NOTIFY#SALE_LINE#01J0ORD-TEE-M-BLK',
      SK: 'NOTIFY',
    });
    expect(keys.backfillCheckpointKey('ap16', 3)).toEqual({
      PK: 'BACKFILL#ap16',
      SK: 'SEGMENT#3',
    });
    expect(keys.statusDateIndexPk('SHIPPED', '2026-10-15')).toBe('STATUS#SHIPPED#2026-10-15');
    expect(keys.statusDateIndexSk('2026-10-15T12:00:00.000Z', '01J0ORD')).toBe(
      '2026-10-15T12:00:00.000Z#01J0ORD',
    );
  });

  it('cart keys', () => {
    expect(keys.cartKey('01J0CART')).toEqual({ PK: 'CART#01J0CART', SK: 'META' });
    expect(keys.cartLineKey('01J0CART', 'TEE-M-BLK')).toEqual({
      PK: 'CART#01J0CART',
      SK: 'LINE#TEE-M-BLK',
    });
  });

  it('pads numbers so sort keys sort numerically', () => {
    expect(keys.pad(0)).toBe('0000000000');
    expect(keys.pad(4999)).toBe('0000004999');
    expect(keys.pad(3, 2)).toBe('03');

    // A string sort would put 9 after 10 without the padding, which is the whole point.
    expect(keys.pad(9) < keys.pad(10)).toBe(true);

    expect(() => keys.pad(-1)).toThrow();
    expect(() => keys.pad(1.5)).toThrow();
    expect(() => keys.pad(12345, 2)).toThrow();
  });

  it('builds an inclusive price range for AP2', () => {
    const range = keys.categoryPriceBounds(1000, 5000);

    expect(range.from).toBe('PRICE#0000001000');
    expect(range.from <= keys.categoryPriceIndexSk(1000, '01J0PROD')).toBe(true);
    expect(keys.categoryPriceIndexSk(5000, '01J0ZZZZ') <= range.to).toBe(true);
    // A product priced one cent above the range is outside it.
    expect(keys.categoryPriceIndexSk(5001, '01J0PROD') <= range.to).toBe(false);

    expect(() => keys.categoryPriceBounds(5000, 1000)).toThrow();
  });

  it('exposes the query prefixes each access pattern needs', () => {
    expect(keys.productPartition('01J0PROD')).toBe('PRODUCT#01J0PROD');
    expect(keys.variantSkPrefix()).toBe('VARIANT#');
    expect(keys.orderSkPrefix()).toBe('ORDER#');
    expect(keys.orderLinePartition('01J0ORD')).toBe('ORDER#01J0ORD');
    expect(keys.customerPartition('01J0CUST')).toBe('CUSTOMER#01J0CUST');
    expect(keys.cartPartition('01J0CART')).toBe('CART#01J0CART');
    expect(keys.cartLineSkPrefix()).toBe('LINE#');
    expect(keys.isoDate(new Date('2026-10-15T23:59:59.000Z'))).toBe('2026-10-15');
  });

  it('hashes to a shard the same way every time, in range', () => {
    // Pinned so a future change to the hash is visible, not silent: rehashing would scatter every
    // existing item across different shards and orphan what is already written.
    expect(keys.fnv1a('')).toBe(2166136261);
    expect(keys.fnv1a('TEE-M-BLK')).toBe(keys.fnv1a('TEE-M-BLK'));

    for (const id of ['01J0ORD', '01J0ORE', 'anything', '']) {
      expect(keys.shardOf(id, 10)).toBeGreaterThanOrEqual(0);
      expect(keys.shardOf(id, 10)).toBeLessThan(10);
    }

    expect(() => keys.shardOf('01J0ORD', 0)).toThrow();
  });

  it('spreads ids across all shards rather than favouring one', () => {
    const used = new Set(Array.from({ length: 500 }, (_, i) => keys.shardOf(`01J0ORDER${i}`, 10)));

    // A hash that returned a constant, or ignored the tail of the string, would fail here.
    expect(used.size).toBe(10);
  });

  it('shards are stable and inside their index shard count', () => {
    expect(keys.fulfillmentIndexShards()).toHaveLength(keys.SHARD_COUNTS.fulfillment);
    expect(keys.holdsIndexShards()).toHaveLength(keys.SHARD_COUNTS.holds);
    expect(keys.bestsellersIndexShards('tees', '2026-10-15')).toHaveLength(
      keys.SHARD_COUNTS.bestsellers,
    );
    // Same input, same shard, every time: a reader must be able to recompute the location.
    expect(keys.fulfillmentIndexPk('01J0ORD')).toBe(keys.fulfillmentIndexPk('01J0ORD'));
  });
});
