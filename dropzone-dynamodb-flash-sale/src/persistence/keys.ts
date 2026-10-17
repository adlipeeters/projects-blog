/**
 * The ONLY place DynamoDB key strings are built.
 *
 * Every format here comes from docs/SPEC.md section 6. Change the spec first, then this file,
 * then the snapshot test in test/unit/keys.snapshot.test.ts. A changed key format must fail CI.
 *
 * Milestone M0: signatures only. Bodies are filled in per milestone, test first.
 */

import tables from '../../schema/tables.json' with { type: 'json' };

const notImplemented = (what: string): never => {
  throw new Error(`keys.${what} is not implemented yet`);
};

/** Shard counts live in schema/tables.json so readers and Terraform cannot disagree. */
export const SHARD_COUNTS = {
  fulfillment: indexShards('commerce', 'fulfillment-index'),
  bestsellers: indexShards('commerce', 'bestsellers-index'),
  holds: indexShards('commerce', 'holds-index'),
} as const;

function indexShards(table: keyof typeof tables.tables, indexName: string): number {
  const index = tables.tables[table].globalSecondaryIndexes.find((i) => i.name === indexName);
  if (!index) throw new Error(`index ${indexName} is missing from schema/tables.json`);
  return index.shards;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 32-bit. The one stable hash used for every shard number, so any reader can recompute
 * where an item lives. Never random (stock buckets are the documented exception).
 */
export function fnv1a(_input: string): number {
  return notImplemented('fnv1a');
}

/** `fnv1a(id) % shardCount`, as a plain number. */
export function shardOf(_id: string, _shardCount: number): number {
  return notImplemented('shardOf');
}

/** Zero-pads a number for use inside a sort key. Prices and counts use 10 digits. */
export function pad(_value: number, _digits = 10): string {
  return notImplemented('pad');
}

// ---------------------------------------------------------------------------
// Catalog table
// ---------------------------------------------------------------------------

/** Product: `PRODUCT#<productId>` / `META` */
export const productKey = (_productId: string): { PK: string; SK: string } =>
  notImplemented('productKey');

/** Variant: `PRODUCT#<productId>` / `VARIANT#<sku>` */
export const variantKey = (_productId: string, _sku: string): { PK: string; SK: string } =>
  notImplemented('variantKey');

/** AP1: every item of one product. */
export const productPartition = (_productId: string): string => notImplemented('productPartition');

/** AP2: `GSI1PK = CATEGORY#<categoryId>` on the catalog table. */
export const categoryIndexPk = (_categoryId: string): string => notImplemented('categoryIndexPk');

/** AP2: `GSI1SK = PRICE#<priceCents, 10 digits>#<productId>` */
export const categoryPriceIndexSk = (_priceCents: number, _productId: string): string =>
  notImplemented('categoryPriceIndexSk');

// ---------------------------------------------------------------------------
// Commerce table
// ---------------------------------------------------------------------------

/** Customer: `CUSTOMER#<customerId>` / `PROFILE` */
export const customerKey = (_customerId: string): { PK: string; SK: string } =>
  notImplemented('customerKey');

/** AP6 email marker: `EMAIL#<lowercased email>` / `EMAIL` */
export const emailMarkerKey = (_email: string): { PK: string; SK: string } =>
  notImplemented('emailMarkerKey');

/** Order header: `CUSTOMER#<customerId>` / `ORDER#<orderId>` */
export const orderKey = (_customerId: string, _orderId: string): { PK: string; SK: string } =>
  notImplemented('orderKey');

/** AP8 prefix: `ORDER#` under a customer partition. */
export const orderSkPrefix = (): string => notImplemented('orderSkPrefix');

/** AP9 LSI sort key: `LSI1SK = STATUS#<status>#<orderId>` */
export const orderStatusLsiSk = (_status: string, _orderId: string): string =>
  notImplemented('orderStatusLsiSk');

/** AP9 prefix: `STATUS#<status>#` for begins_with on the LSI. */
export const orderStatusLsiPrefix = (_status: string): string =>
  notImplemented('orderStatusLsiPrefix');

/** Order line: `ORDER#<orderId>` / `LINE#<sku>` */
export const orderLineKey = (_orderId: string, _sku: string): { PK: string; SK: string } =>
  notImplemented('orderLineKey');

/** AP10: every line of one order. */
export const orderLinePartition = (_orderId: string): string =>
  notImplemented('orderLinePartition');

/** AP12 sparse sharded GSI: `GSI1PK = FULFILL#<0-9>`, sharded on orderId. */
export const fulfillmentIndexPk = (_orderId: string): string =>
  notImplemented('fulfillmentIndexPk');

/** AP12: every shard of the fulfillment queue, for the parallel fan-out query. */
export const fulfillmentIndexShards = (): string[] => notImplemented('fulfillmentIndexShards');

/** AP12 sort key: `GSI1SK = <placedAt>#<orderId>`, oldest first. */
export const fulfillmentIndexSk = (_placedAt: string, _orderId: string): string =>
  notImplemented('fulfillmentIndexSk');

/** Stock bucket: `STOCK#<sku>#<bucket 00-09>` / `STOCK` */
export const stockBucketKey = (_sku: string, _bucket: number): { PK: string; SK: string } =>
  notImplemented('stockBucketKey');

/** AP13: every bucket key of one SKU, for the BatchGetItem that sums availability. */
export const stockBucketKeys = (
  _sku: string,
  _bucketCount: number,
): Array<{ PK: string; SK: string }> => notImplemented('stockBucketKeys');

/** Hold: `CUSTOMER#<customerId>` / `HOLD#<holdId>` */
export const holdKey = (_customerId: string, _holdId: string): { PK: string; SK: string } =>
  notImplemented('holdKey');

/** AP15 sparse sharded GSI: `GSI3PK = HOLDS#<0-3>`, sharded on holdId. */
export const holdsIndexPk = (_holdId: string): string => notImplemented('holdsIndexPk');

/** AP15: every shard the sweeper queries each minute. */
export const holdsIndexShards = (): string[] => notImplemented('holdsIndexShards');

/** AP15 sort key: `GSI3SK = <expiresAt ISO>#<holdId>` */
export const holdsIndexSk = (_expiresAt: string, _holdId: string): string =>
  notImplemented('holdsIndexSk');

/** Idempotency key: `IDEMPOTENCY#<customerId>#<key>` / `IDEMPOTENCY` */
export const idempotencyKey = (_customerId: string, _key: string): { PK: string; SK: string } =>
  notImplemented('idempotencyKey');

/** Sales aggregate: `SALES#<categoryId>#<yyyy-mm-dd>` / `SKU#<sku>` */
export const salesAggregateKey = (
  _categoryId: string,
  _date: string,
  _sku: string,
): { PK: string; SK: string } => notImplemented('salesAggregateKey');

/** AP14 sharded GSI: `GSI2PK = BEST#<categoryId>#<yyyy-mm-dd>#<0-3>`, sharded on sku. */
export const bestsellersIndexPk = (_categoryId: string, _date: string, _sku: string): string =>
  notImplemented('bestsellersIndexPk');

/** AP14: every shard of one category and day. */
export const bestsellersIndexShards = (_categoryId: string, _date: string): string[] =>
  notImplemented('bestsellersIndexShards');

/** Notification marker: `NOTIFY#<type>#<entityId>` / `NOTIFY` */
export const notificationMarkerKey = (
  _type: string,
  _entityId: string,
): { PK: string; SK: string } => notImplemented('notificationMarkerKey');

/** Backfill checkpoint: `BACKFILL#<jobId>` / `SEGMENT#<n>` */
export const backfillCheckpointKey = (
  _jobId: string,
  _segment: number,
): { PK: string; SK: string } => notImplemented('backfillCheckpointKey');

/** AP16, milestone M7: `GSI4PK = STATUS#<status>#<yyyy-mm-dd>` */
export const statusDateIndexPk = (_status: string, _date: string): string =>
  notImplemented('statusDateIndexPk');

/** AP16, milestone M7: `GSI4SK = <placedAt>#<orderId>` */
export const statusDateIndexSk = (_placedAt: string, _orderId: string): string =>
  notImplemented('statusDateIndexSk');

// ---------------------------------------------------------------------------
// Carts table (global)
// ---------------------------------------------------------------------------

/** Cart header: `CART#<cartId>` / `META` */
export const cartKey = (_cartId: string): { PK: string; SK: string } => notImplemented('cartKey');

/** Cart line: `CART#<cartId>` / `LINE#<sku>` */
export const cartLineKey = (_cartId: string, _sku: string): { PK: string; SK: string } =>
  notImplemented('cartLineKey');

/** AP3: a cart and all of its lines. */
export const cartPartition = (_cartId: string): string => notImplemented('cartPartition');
