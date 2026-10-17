/**
 * Product and Variant: domain to item, and item back to domain.
 *
 * The two live in the same partition (`PRODUCT#<productId>`), which is what lets AP1 fetch a
 * product and all of its variants with a single Query. Only the product META item carries the
 * category index attributes, so variants never appear in a category listing.
 */

import { z } from 'zod';

import type { Product, ProductSummary, Variant } from '../../domain/product.js';
import { categoryId, productId, sku } from '../../domain/ids.js';
import { EUR, money } from '../../domain/money.js';
import { EntityType, SCHEMA_VERSION } from '../entity-types.js';
import {
  categoryIndexAttributes,
  partitionKeyOf,
  productIdFromPartition,
  productKey,
  variantKey,
} from '../keys.js';
import { buildDomain, parseItem } from './parse.js';

const currencySchema = z.literal(EUR);

const productItemSchema = z.object({
  entityType: z.literal(EntityType.Product),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  productId: z.string(),
  name: z.string().min(1),
  description: z.string(),
  categoryId: z.string(),
  fromPriceCents: z.number().int().nonnegative(),
  currency: currencySchema,
  imageUrl: z.string(),
  isDrop: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const variantItemSchema = z.object({
  entityType: z.literal(EntityType.Variant),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  productId: z.string(),
  sku: z.string(),
  size: z.string(),
  color: z.string(),
  priceCents: z.number().int().nonnegative(),
  currency: currencySchema,
  stockBuckets: z.number().int().positive(),
});

/**
 * What `category-price-index` actually returns: the base and index keys, plus the three projected
 * attributes. No entityType, no categoryId, no description.
 */
const categoryIndexItemSchema = z.object({
  name: z.string().min(1),
  fromPriceCents: z.number().int().nonnegative(),
  imageUrl: z.string(),
});

export function productToItem(product: Product, now: Date, version = 1): Record<string, unknown> {
  return {
    ...productKey(product.productId),
    ...categoryIndexAttributes(
      product.categoryId,
      product.fromPrice.amountCents,
      product.productId,
    ),
    entityType: EntityType.Product,
    schemaVersion: SCHEMA_VERSION,
    version,
    productId: product.productId,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    fromPriceCents: product.fromPrice.amountCents,
    currency: product.fromPrice.currency,
    imageUrl: product.imageUrl,
    isDrop: product.isDrop,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function productFromItem(raw: unknown): Product {
  const item = parseItem(productItemSchema, EntityType.Product, raw);

  return buildDomain(EntityType.Product, raw, () => ({
    productId: productId(item.productId),
    name: item.name,
    description: item.description,
    categoryId: categoryId(item.categoryId),
    fromPrice: money(item.fromPriceCents, item.currency),
    imageUrl: item.imageUrl,
    isDrop: item.isDrop,
  }));
}

export function variantToItem(variant: Variant, version = 1): Record<string, unknown> {
  return {
    ...variantKey(variant.productId, variant.sku),
    entityType: EntityType.Variant,
    schemaVersion: SCHEMA_VERSION,
    version,
    productId: variant.productId,
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    priceCents: variant.price.amountCents,
    currency: variant.price.currency,
    stockBuckets: variant.stockBuckets,
  };
}

export function variantFromItem(raw: unknown): Variant {
  const item = parseItem(variantItemSchema, EntityType.Variant, raw);

  return buildDomain(EntityType.Variant, raw, () => ({
    productId: productId(item.productId),
    sku: sku(item.sku),
    size: item.size,
    color: item.color,
    price: money(item.priceCents, item.currency),
    stockBuckets: item.stockBuckets,
  }));
}

/** AP2: an entry from the category listing, built from the projected attributes only. */
export function productSummaryFromIndexItem(raw: unknown): ProductSummary {
  const item = parseItem(categoryIndexItemSchema, EntityType.Product, raw);

  return buildDomain(EntityType.Product, raw, () => ({
    // The id is not projected; it is read back out of the partition key the index carries anyway.
    productId: productId(
      productIdFromPartition(String(partitionKeyOf(raw as Record<string, unknown>))),
    ),
    name: item.name,
    fromPrice: money(item.fromPriceCents),
    imageUrl: item.imageUrl,
  }));
}
