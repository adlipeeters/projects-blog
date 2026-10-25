/**
 * Response DTO for available stock (AP13).
 *
 * The per-bucket breakdown is returned on purpose. It is the one place the sharding is meant to be
 * visible, because it is what the load runs and the article's before-and-after tables read, and
 * because "how many are left" is more convincing next to "and here is where they are".
 */

import type { SkuStock } from '../../persistence/repositories/stock.js';

export type StockBucketDto = {
  readonly bucket: number;
  readonly available: number;
};

export type StockDto = {
  readonly sku: string;
  readonly available: number;
  readonly buckets: readonly StockBucketDto[];
};

export const toStockResponse = (stock: SkuStock): StockDto => ({
  sku: stock.sku,
  available: stock.available,
  buckets: stock.buckets.map((bucket) => ({
    bucket: bucket.bucket,
    available: bucket.available,
  })),
});
