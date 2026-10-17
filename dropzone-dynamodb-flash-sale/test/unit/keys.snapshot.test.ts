import { describe, it, expect } from 'vitest';
import * as keys from '../../src/persistence/keys.js';

/**
 * The CI gate from spec section 11: every key format in spec section 6, pinned.
 *
 * Skipped while keys.ts is a signature stub (M0). Unskip in M1 together with the first key
 * builders, and from then on a changed key format fails CI and needs human review.
 */
describe.skip('key formats (spec section 6)', () => {
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
