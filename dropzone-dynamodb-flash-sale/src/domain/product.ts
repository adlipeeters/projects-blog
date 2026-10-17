/**
 * Catalog entities.
 *
 * `stockBuckets` is the flash-sale knob: a normal variant has one stock item, a drop variant has
 * ten, so checkout writes spread across ten partitions instead of hammering one (spec section 9).
 */

import type { CategoryId, ProductId, Sku } from './ids.js';
import type { Money } from './money.js';

export type Product = {
  readonly productId: ProductId;
  readonly name: string;
  readonly description: string;
  readonly categoryId: CategoryId;
  /** Cheapest variant price, denormalised so a category listing needs one item per product. */
  readonly fromPrice: Money;
  readonly imageUrl: string;
  /** True for a flash-sale product. Drives bucket counts and the article's two load runs. */
  readonly isDrop: boolean;
};

/**
 * What a category listing can show.
 *
 * Deliberately smaller than Product: `category-price-index` projects only name, fromPriceCents and
 * imageUrl, so a listing cannot promise a description or a category without a second read per
 * product. AP2 returns these; AP1 returns the full Product.
 */
export type ProductSummary = {
  readonly productId: ProductId;
  readonly name: string;
  readonly fromPrice: Money;
  readonly imageUrl: string;
};

export type Variant = {
  readonly productId: ProductId;
  readonly sku: Sku;
  readonly size: string;
  readonly color: string;
  readonly price: Money;
  /** 1 for normal variants, 10 for drops. */
  readonly stockBuckets: number;
};

export const DEFAULT_STOCK_BUCKETS = 1;
export const DROP_STOCK_BUCKETS = 10;

/** One stock bucket of one variant. Buckets are summed to answer "how many are left" (AP13). */
export type StockBucket = {
  readonly sku: Sku;
  readonly bucket: number;
  readonly available: number;
  readonly version: number;
};

export const totalAvailable = (buckets: readonly StockBucket[]): number =>
  buckets.reduce((units, bucket) => units + bucket.available, 0);
