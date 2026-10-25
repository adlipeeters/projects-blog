/**
 * Stock buckets: seeding them, and reading them back (AP13).
 *
 * Decrementing them is part of the checkout transaction, so that lives in the order repository
 * alongside everything else that has to succeed or fail together.
 */

import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';

import type { Sku } from '../../domain/ids.js';
import type { StockBucket } from '../../domain/product.js';
import { totalAvailable } from '../../domain/product.js';
import { commerceTable } from '../../shared/env.js';
import { NotFoundError } from '../../shared/errors.js';
import { batchWriteAll } from '../batch.js';
import { documentClient } from '../client.js';
import { stockBucketKeys } from '../keys.js';
import { stockBucketFromItem, stockBucketToItem } from '../mappers/stock.js';
import { catalogRepository } from './catalog.js';

/** AP13's answer: the sum, and the buckets it came from. */
export type SkuStock = {
  readonly sku: Sku;
  readonly available: number;
  readonly buckets: readonly StockBucket[];
};

export function stockRepository(catalog = catalogRepository()) {
  const table = (): string => commerceTable();

  return {
    /**
     * Splits a SKU's units evenly across its buckets.
     *
     * 500 units across 10 buckets is 10 items of 50. An uneven total puts the remainder in the
     * first buckets, so the sum is exactly what was asked for: a unit lost to rounding would break
     * the invariant check before the run even starts.
     */
    async seed(sku: Sku, units: number, bucketCount: number): Promise<StockBucket[]> {
      if (!Number.isInteger(units) || units < 0) {
        throw new Error(`Units must be a non-negative whole number, got ${String(units)}`);
      }

      const base = Math.floor(units / bucketCount);
      const remainder = units % bucketCount;

      const buckets: StockBucket[] = Array.from({ length: bucketCount }, (_, bucket) => ({
        sku,
        bucket,
        available: base + (bucket < remainder ? 1 : 0),
        version: 1,
      }));

      await batchWriteAll(
        table(),
        buckets.map((bucket) => ({ PutRequest: { Item: stockBucketToItem(bucket) } })),
      );

      return buckets;
    },

    /**
     * AP13: `BatchGetItem` over every bucket of a SKU, strongly consistent.
     *
     * Strong because the answer is a sum of counters that other requests are decrementing right
     * now, and "how many are left" is the one number a sale cannot be vague about.
     */
    async readBuckets(sku: Sku, bucketCount: number): Promise<StockBucket[]> {
      const result = await documentClient().send(
        new BatchGetCommand({
          RequestItems: {
            [table()]: {
              Keys: [...stockBucketKeys(sku, bucketCount)],
              ConsistentRead: true,
            },
          },
        }),
      );

      return (result.Responses?.[table()] ?? [])
        .map(stockBucketFromItem)
        .sort((left, right) => left.bucket - right.bucket);
    },

    /** AP13's answer: the sum across buckets. */
    async available(sku: Sku, bucketCount: number): Promise<number> {
      return totalAvailable(await this.readBuckets(sku, bucketCount));
    },

    /**
     * AP13 for a sku the caller knows nothing else about.
     *
     * The bucket count lives on the variant, so this is a catalog lookup followed by the batch
     * read. Reading the count rather than assuming one is what lets the same route answer for a
     * normal variant with one bucket and a drop with ten.
     */
    async forSku(sku: Sku): Promise<SkuStock> {
      const pointers = await catalog.resolveSkus([sku]);
      const pointer = pointers.get(sku);
      if (pointer === undefined) {
        throw new NotFoundError(`No such sku: ${sku}`);
      }

      const variants = await catalog.loadVariants([pointer]);
      const variant = variants.get(sku);
      if (variant === undefined) {
        throw new NotFoundError(`No such sku: ${sku}`);
      }

      const buckets = await this.readBuckets(sku, variant.stockBuckets);
      return { sku, available: totalAvailable(buckets), buckets };
    },
  };
}
