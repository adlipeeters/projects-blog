/**
 * The ONLY place DynamoDB key strings are built.
 *
 * Every format here comes from docs/SPEC.md section 6. Change the spec first, then this file,
 * then the snapshot test in test/unit/keys.snapshot.test.ts. A changed key format must fail the
 * test run.
 *
 * Two rules worth repeating, because they are easy to get wrong and expensive to fix later:
 *
 * - Numbers inside sort keys are zero-padded, so they sort as numbers. `PRICE#9` sorts after
 *   `PRICE#10` as a string; `PRICE#0000000009` does not.
 * - Shard numbers come from one stable hash, never from randomness, so any reader can recompute
 *   which shard an item is in. Stock buckets are the documented exception: the writer picks a
 *   bucket at random and stores the choice in the order's allocations.
 */

import tables from '../../schema/tables.json' with { type: 'json' };

/** A full primary key. The generic attribute names let new entities fit without schema changes. */
export type ItemKey = {
  readonly PK: string;
  readonly SK: string;
};

/**
 * The key attribute names, exported so that mappers and tests never spell them out.
 * ESLint forbids these literals everywhere except this file.
 */
export const KEY_ATTRIBUTES = ['PK', 'SK'] as const;

/** For KeyConditionExpression attribute names. Every table in this project uses the same two. */
export const [PARTITION_ATTRIBUTE, SORT_ATTRIBUTE] = KEY_ATTRIBUTES;

/** Reads the partition key off a raw item, so callers never name the attribute. */
export const partitionKeyOf = (raw: Record<string, unknown>): unknown => raw[PARTITION_ATTRIBUTE];

/** Reads the sort key off a raw item. */
export const sortKeyOf = (raw: Record<string, unknown>): unknown => raw[SORT_ATTRIBUTE];

/** Shard counts live in schema/tables.json so readers and Terraform cannot disagree. */
export const SHARD_COUNTS = {
  fulfillment: indexShards('commerce', 'fulfillment-index'),
  bestsellers: indexShards('commerce', 'bestsellers-index'),
  holds: indexShards('commerce', 'holds-index'),
} as const;

function findIndex(table: keyof typeof tables.tables, indexName: string) {
  const index = tables.tables[table].globalSecondaryIndexes.find((i) => i.name === indexName);
  if (!index) throw new Error(`index ${indexName} is missing from schema/tables.json`);
  return index;
}

function indexShards(table: keyof typeof tables.tables, indexName: string): number {
  return findIndex(table, indexName).shards;
}

/**
 * AP2's index: its name from schema/tables.json, its attribute names from here.
 *
 * A repository needs both to write a KeyConditionExpression, and neither should be a literal
 * anywhere else.
 */
export const CATEGORY_PRICE_INDEX = {
  name: findIndex('catalog', 'category-price-index').name,
  partitionAttribute: 'GSI1PK',
  sortAttribute: 'GSI1SK',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a, 32-bit. The one stable hash used for every shard number, so any reader can recompute
 * where an item lives.
 *
 * Deliberately not a cryptographic hash: it has to be identical in every runtime that reads this
 * table, cheap enough to run per request, and small enough to write out by hand in an article.
 */
export function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** `fnv1a(id) % shardCount`. */
export function shardOf(id: string, shardCount: number): number {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`Shard count must be a positive integer, got ${shardCount}`);
  }
  return fnv1a(id) % shardCount;
}

/** Every shard number of an index, for the parallel fan-out queries in AP12, AP14 and AP15. */
const shardRange = (shardCount: number): readonly number[] =>
  Array.from({ length: shardCount }, (_, shard) => shard);

/**
 * Zero-pads a number for use inside a sort key. Prices and counts use 10 digits (spec section 3).
 */
export function pad(value: number, digits = 10): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Cannot pad ${value}: expected a non-negative whole number`);
  }
  const padded = String(value).padStart(digits, '0');
  if (padded.length > digits) {
    throw new Error(`Cannot pad ${value} into ${digits} digits without losing sort order`);
  }
  return padded;
}

// ---------------------------------------------------------------------------
// Catalog table
// ---------------------------------------------------------------------------

/** AP1: every item of one product, the META item and its variants. */
export const productPartition = (productId: string): string => `PRODUCT#${productId}`;

/** Product: `PRODUCT#<productId>` / `META` */
export const productKey = (productId: string): ItemKey => ({
  PK: productPartition(productId),
  SK: 'META',
});

/** Variant: `PRODUCT#<productId>` / `VARIANT#<sku>` */
export const variantKey = (productId: string, sku: string): ItemKey => ({
  PK: productPartition(productId),
  SK: `VARIANT#${sku}`,
});

/** AP1: the prefix that selects variants only. */
export const variantSkPrefix = (): string => 'VARIANT#';

const PRODUCT_PREFIX = 'PRODUCT#';

/**
 * The product id back out of a partition key.
 *
 * The `category-price-index` projection is deliberately small and does not include `productId`,
 * but index entries always carry the base table's keys, and the id is already in there. Reading it
 * back beats paying to store it twice.
 */
export function productIdFromPartition(partitionKey: string): string {
  if (!partitionKey.startsWith(PRODUCT_PREFIX)) {
    throw new Error(`Not a product partition key: ${partitionKey}`);
  }
  return partitionKey.slice(PRODUCT_PREFIX.length);
}

/**
 * AP2: `GSI1PK = CATEGORY#<categoryId>` on the catalog table.
 *
 * Only the product META item carries this attribute, which is what makes `category-price-index`
 * sparse: variants never appear in a category listing.
 */
export const categoryIndexPk = (categoryId: string): string => `CATEGORY#${categoryId}`;

/**
 * AP2: the index attributes a product META item carries.
 *
 * Returned as a complete attribute map so a mapper never names `GSI1PK` or `GSI1SK` itself. A
 * variant gets no such attributes, which is what makes the index sparse.
 */
export const categoryIndexAttributes = (
  categoryId: string,
  fromPriceCents: number,
  productId: string,
): { readonly GSI1PK: string; readonly GSI1SK: string } => ({
  GSI1PK: categoryIndexPk(categoryId),
  GSI1SK: categoryPriceIndexSk(fromPriceCents, productId),
});

/** AP2: `GSI1SK = PRICE#<priceCents, 10 digits>#<productId>`, cheapest first. */
export const categoryPriceIndexSk = (priceCents: number, productId: string): string =>
  `PRICE#${pad(priceCents)}#${productId}`;

/**
 * The largest value a 10-digit padded sort key can hold: 9,999,999,999 cents, about 100 million
 * euros. An open-ended price range stops here rather than at Number.MAX_SAFE_INTEGER, which has 16
 * digits and would not pad.
 */
export const MAX_PADDED_CENTS = 9_999_999_999;

/** AP2: the two bounds of a BETWEEN on the price index. */
export const categoryPriceBounds = (
  minPriceCents = 0,
  maxPriceCents: number = MAX_PADDED_CENTS,
): { readonly from: string; readonly to: string } => {
  if (maxPriceCents < minPriceCents) {
    throw new Error('Price range is inverted');
  }
  return {
    from: `PRICE#${pad(minPriceCents)}`,
    // The highest product id that can follow the padded price, so the upper bound is inclusive.
    to: `PRICE#${pad(maxPriceCents)}#￿`,
  };
};

// ---------------------------------------------------------------------------
// Commerce table
// ---------------------------------------------------------------------------

/** A customer's partition holds the profile, the orders (AP8) and the holds. */
export const customerPartition = (customerId: string): string => `CUSTOMER#${customerId}`;

/** Customer: `CUSTOMER#<customerId>` / `PROFILE` */
export const customerKey = (customerId: string): ItemKey => ({
  PK: customerPartition(customerId),
  SK: 'PROFILE',
});

/**
 * AP6 email marker: `EMAIL#<lowercased email>` / `EMAIL`
 *
 * Its own item, so AP5 can make the email unique with `attribute_not_exists(PK)` inside the same
 * transaction that creates the customer.
 *
 * Lowercased here as well as in the domain, because `EMAIL#Ada@example.com` and
 * `EMAIL#ada@example.com` are different partitions and the uniqueness check would miss.
 */
export const emailMarkerKey = (email: string): ItemKey => ({
  PK: `EMAIL#${email.trim().toLowerCase()}`,
  SK: 'EMAIL',
});

/** Order header: `CUSTOMER#<customerId>` / `ORDER#<orderId>` */
export const orderKey = (customerId: string, orderId: string): ItemKey => ({
  PK: customerPartition(customerId),
  SK: `ORDER#${orderId}`,
});

/** AP8: `begins_with(SK, ORDER#)` inside a customer partition, newest first. */
export const orderSkPrefix = (): string => 'ORDER#';

/** AP9 LSI sort key: `LSI1SK = STATUS#<status>#<orderId>` */
export const orderStatusLsiSk = (status: string, orderId: string): string =>
  `STATUS#${status}#${orderId}`;

/** AP9: `begins_with(LSI1SK, STATUS#<status>#)`, read strongly consistent. */
export const orderStatusLsiPrefix = (status: string): string => `STATUS#${status}#`;

/** Order line: `ORDER#<orderId>` / `LINE#<sku>`. Immutable. */
export const orderLineKey = (orderId: string, sku: string): ItemKey => ({
  PK: orderLinePartition(orderId),
  SK: `LINE#${sku}`,
});

/** AP10: every line of one order. */
export const orderLinePartition = (orderId: string): string => `ORDER#${orderId}`;

/**
 * AP12 sparse sharded GSI: `GSI1PK = FULFILL#<0-9>`, sharded on the order id.
 *
 * Ten shards because every order placed during a drop writes this index, and a throttled GSI
 * throttles writes to the base table.
 */
export const fulfillmentIndexPk = (orderId: string): string =>
  `FULFILL#${shardOf(orderId, SHARD_COUNTS.fulfillment)}`;

/** AP12: every shard, queried in parallel and merged by sort key. */
export const fulfillmentIndexShards = (): readonly string[] =>
  shardRange(SHARD_COUNTS.fulfillment).map((shard) => `FULFILL#${shard}`);

/** AP12 sort key: `GSI1SK = <placedAt>#<orderId>`, oldest first. */
export const fulfillmentIndexSk = (placedAt: string, orderId: string): string =>
  `${placedAt}#${orderId}`;

/**
 * Stock bucket: `STOCK#<sku>#<bucket 00-09>` / `STOCK`
 *
 * The bucket number is in the partition key, not the sort key. Items sharing a partition key share
 * a partition, so a bucket in the sort key would spread nothing.
 */
export const stockBucketKey = (sku: string, bucket: number): ItemKey => ({
  PK: `STOCK#${sku}#${pad(bucket, 2)}`,
  SK: 'STOCK',
});

/** AP13: every bucket of one SKU, for the strongly consistent BatchGetItem that sums them. */
export const stockBucketKeys = (sku: string, bucketCount: number): readonly ItemKey[] =>
  shardRange(bucketCount).map((bucket) => stockBucketKey(sku, bucket));

/** Hold: `CUSTOMER#<customerId>` / `HOLD#<holdId>` */
export const holdKey = (customerId: string, holdId: string): ItemKey => ({
  PK: customerPartition(customerId),
  SK: `HOLD#${holdId}`,
});

/** AP15 sparse sharded GSI: `GSI3PK = HOLDS#<0-3>`, present only while the hold is HELD. */
export const holdsIndexPk = (holdId: string): string =>
  `HOLDS#${shardOf(holdId, SHARD_COUNTS.holds)}`;

/** AP15: the shards the sweeper queries every minute. */
export const holdsIndexShards = (): readonly string[] =>
  shardRange(SHARD_COUNTS.holds).map((shard) => `HOLDS#${shard}`);

/** AP15 sort key: `GSI3SK = <expiresAt ISO>#<holdId>`, so `GSI3SK < now` finds expired holds. */
export const holdsIndexSk = (expiresAt: string, holdId: string): string => `${expiresAt}#${holdId}`;

/** Idempotency key: `IDEMPOTENCY#<customerId>#<key>` / `IDEMPOTENCY` */
export const idempotencyKey = (customerId: string, key: string): ItemKey => ({
  PK: `IDEMPOTENCY#${customerId}#${key}`,
  SK: 'IDEMPOTENCY',
});

/** Sales aggregate: `SALES#<categoryId>#<yyyy-mm-dd>` / `SKU#<sku>` */
export const salesAggregateKey = (categoryId: string, date: string, sku: string): ItemKey => ({
  PK: `SALES#${categoryId}#${date}`,
  SK: `SKU#${sku}`,
});

/**
 * AP14 sharded GSI: `GSI2PK = BEST#<categoryId>#<yyyy-mm-dd>#<0-3>`, sharded on the SKU.
 *
 * The sort key is the `unitsSold` Number itself, so a single `ADD unitsSold :n` keeps the index
 * current without a read.
 */
export const bestsellersIndexPk = (categoryId: string, date: string, sku: string): string =>
  `BEST#${categoryId}#${date}#${shardOf(sku, SHARD_COUNTS.bestsellers)}`;

/** AP14: every shard of one category and day, merged to a top N. */
export const bestsellersIndexShards = (categoryId: string, date: string): readonly string[] =>
  shardRange(SHARD_COUNTS.bestsellers).map((shard) => `BEST#${categoryId}#${date}#${shard}`);

/**
 * Notification marker: `NOTIFY#<type>#<entityId>` / `NOTIFY`
 *
 * Written with `attribute_not_exists` so a replayed stream record is skipped instead of
 * double-counting an aggregate or sending a second notification.
 */
export const notificationMarkerKey = (type: string, entityId: string): ItemKey => ({
  PK: `NOTIFY#${type}#${entityId}`,
  SK: 'NOTIFY',
});

/** Backfill checkpoint: `BACKFILL#<jobId>` / `SEGMENT#<n>` (spec section 10). */
export const backfillCheckpointKey = (jobId: string, segment: number): ItemKey => ({
  PK: `BACKFILL#${jobId}`,
  SK: `SEGMENT#${segment}`,
});

/** AP16, milestone M7: `GSI4PK = STATUS#<status>#<yyyy-mm-dd>` */
export const statusDateIndexPk = (status: string, date: string): string =>
  `STATUS#${status}#${date}`;

/** AP16, milestone M7: `GSI4SK = <placedAt>#<orderId>` */
export const statusDateIndexSk = (placedAt: string, orderId: string): string =>
  `${placedAt}#${orderId}`;

// ---------------------------------------------------------------------------
// Carts table (global)
// ---------------------------------------------------------------------------

/** AP3: a cart and all of its lines. */
export const cartPartition = (cartId: string): string => `CART#${cartId}`;

/** Cart header: `CART#<cartId>` / `META` */
export const cartKey = (cartId: string): ItemKey => ({
  PK: cartPartition(cartId),
  SK: 'META',
});

/** Cart line: `CART#<cartId>` / `LINE#<sku>` */
export const cartLineKey = (cartId: string, sku: string): ItemKey => ({
  PK: cartPartition(cartId),
  SK: `LINE#${sku}`,
});

/** AP4: the prefix that selects a cart's lines without its header. */
export const cartLineSkPrefix = (): string => 'LINE#';

/** The date part of an ISO timestamp, used by the aggregate and AP16 keys. */
export const isoDate = (at: Date): string => at.toISOString().slice(0, 10);
