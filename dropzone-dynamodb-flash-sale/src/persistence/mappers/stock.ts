/**
 * Stock buckets.
 *
 * The bucket number is part of the partition key (`STOCK#<sku>#<bucket>`), not the sort key: items
 * sharing a partition key share a partition, so a bucket in the sort key would spread nothing.
 */

import { z } from 'zod';

import { sku as parseSku } from '../../domain/ids.js';
import type { StockBucket } from '../../domain/product.js';
import { EntityType, SCHEMA_VERSION } from '../entity-types.js';
import { stockBucketKey } from '../keys.js';
import { buildDomain, parseItem } from './parse.js';

const stockItemSchema = z.object({
  entityType: z.literal(EntityType.StockBucket),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  sku: z.string(),
  bucket: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});

export const stockBucketToItem = (bucket: StockBucket): Record<string, unknown> => ({
  ...stockBucketKey(bucket.sku, bucket.bucket),
  entityType: EntityType.StockBucket,
  schemaVersion: SCHEMA_VERSION,
  version: bucket.version,
  sku: bucket.sku,
  bucket: bucket.bucket,
  available: bucket.available,
});

export function stockBucketFromItem(raw: unknown): StockBucket {
  const item = parseItem(stockItemSchema, EntityType.StockBucket, raw);

  return buildDomain(EntityType.StockBucket, raw, () => ({
    sku: parseSku(item.sku),
    bucket: item.bucket,
    available: item.available,
    version: item.version,
  }));
}
