/**
 * The catalog repository: AP1 and AP2.
 *
 * No Scan, no filter expressions on the hot path, and every key built in keys.ts. The table name is
 * read per call rather than at import time, because a Lambda's environment is set before the first
 * invocation but tests set it after importing this module.
 */

import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { CategoryId, ProductId, Sku } from '../../domain/ids.js';
import type { Product, ProductSummary, Variant } from '../../domain/product.js';
import { catalogTable } from '../../shared/env.js';
import { decodeCursor, encodeCursor, pageSize, type Page } from '../../shared/pagination.js';
import { batchWriteAll } from '../batch.js';
import { documentClient } from '../client.js';
import {
  CATEGORY_PRICE_INDEX,
  PARTITION_ATTRIBUTE,
  categoryIndexPk,
  categoryPriceBounds,
  productPartition,
  skuPointerKey,
  sortKeyOf,
  variantKey,
  variantSkPrefix,
} from '../keys.js';
import {
  productFromItem,
  productSummaryFromIndexItem,
  productToItem,
  skuPointerFromItem,
  skuPointerToItem,
  variantFromItem,
  variantToItem,
} from '../mappers/product.js';
import type { SkuPointer } from '../mappers/product.js';

export type ProductWithVariants = {
  readonly product: Product;
  readonly variants: readonly Variant[];
};

export type CategoryQuery = {
  readonly categoryId: CategoryId;
  readonly minPriceCents?: number;
  readonly maxPriceCents?: number;
  readonly limit?: number;
  readonly cursor?: string;
};

export function catalogRepository() {
  const table = (): string => catalogTable();

  return {
    /**
     * Writes a product and its variants. Used by the seed script, not by a request path, so it is
     * a batch write rather than a transaction: a partially seeded product is fine to retry.
     */
    async putProduct(product: Product, variants: readonly Variant[], now = new Date()) {
      await batchWriteAll(table(), [
        { PutRequest: { Item: productToItem(product, now) } },
        ...variants.map((variant) => ({ PutRequest: { Item: variantToItem(variant) } })),
        // One pointer per variant, so checkout can resolve a sku without an index.
        ...variants.map((variant) => ({
          PutRequest: { Item: skuPointerToItem(variant, product.categoryId) },
        })),
      ]);
    },

    /**
     * AP1: `Query PK = PRODUCT#<productId>`.
     *
     * One request returns the META item and every variant, because they share a partition. The
     * read is eventually consistent: a catalog change being visible a few milliseconds late costs
     * nothing, and a strongly consistent read would cost twice the capacity.
     */
    async getProduct(productId: ProductId): Promise<ProductWithVariants | null> {
      const result = await documentClient().send(
        new QueryCommand({
          TableName: table(),
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': PARTITION_ATTRIBUTE },
          ExpressionAttributeValues: { ':pk': productPartition(productId) },
        }),
      );

      const items = result.Items ?? [];
      if (items.length === 0) {
        return null;
      }

      const prefix = variantSkPrefix();
      const isVariant = (item: Record<string, unknown>): boolean => {
        const sortKey = sortKeyOf(item);
        return typeof sortKey === 'string' && sortKey.startsWith(prefix);
      };

      const meta = items.find((item) => !isVariant(item));
      if (meta === undefined) {
        // Variants without their product: possible mid-seed, and never a valid read.
        return null;
      }

      return {
        product: productFromItem(meta),
        variants: items.filter(isVariant).map((item) => variantFromItem(item)),
      };
    },

    /**
     * Resolves skus to the products they belong to (part of AP7, spec section 7 step 2).
     *
     * A key lookup on the pointer items, not an index query, so it is strongly consistent and
     * costs one read unit per sku.
     */
    async resolveSkus(skus: readonly Sku[]): Promise<Map<Sku, SkuPointer>> {
      const resolved = new Map<Sku, SkuPointer>();
      if (skus.length === 0) {
        return resolved;
      }

      const result = await documentClient().send(
        new BatchGetCommand({
          RequestItems: {
            [table()]: {
              Keys: [...new Set(skus)].map((sku) => skuPointerKey(sku)),
              ConsistentRead: true,
            },
          },
        }),
      );

      for (const item of result.Responses?.[table()] ?? []) {
        const pointer = skuPointerFromItem(item);
        resolved.set(pointer.sku, pointer);
      }

      return resolved;
    },

    /** The variants themselves: the price to snapshot and the bucket count to allocate from. */
    async loadVariants(pointers: readonly SkuPointer[]): Promise<Map<Sku, Variant>> {
      const variants = new Map<Sku, Variant>();
      if (pointers.length === 0) {
        return variants;
      }

      const result = await documentClient().send(
        new BatchGetCommand({
          RequestItems: {
            [table()]: {
              Keys: pointers.map((pointer) => variantKey(pointer.productId, pointer.sku)),
              ConsistentRead: true,
            },
          },
        }),
      );

      for (const item of result.Responses?.[table()] ?? []) {
        const variant = variantFromItem(item);
        variants.set(variant.sku, variant);
      }

      return variants;
    },

    /**
     * AP2: `Query GSI1PK = CATEGORY#<categoryId> AND GSI1SK BETWEEN PRICE#<min> AND PRICE#<max>`.
     *
     * Cheapest first, straight out of the index's sort order: no sorting in the Lambda, and no
     * filter expression, so the capacity consumed is proportional to what is returned.
     */
    async listCategory(query: CategoryQuery): Promise<Page<ProductSummary>> {
      // Both bounds are optional; keys.ts owns what "no upper bound" means, because it owns the
      // padding width that makes the range sortable at all.
      const bounds = categoryPriceBounds(query.minPriceCents, query.maxPriceCents);
      const startKey = decodeCursor(query.cursor);

      const result = await documentClient().send(
        new QueryCommand({
          TableName: table(),
          IndexName: CATEGORY_PRICE_INDEX.name,
          KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :from AND :to',
          ExpressionAttributeNames: {
            '#pk': CATEGORY_PRICE_INDEX.partitionAttribute,
            '#sk': CATEGORY_PRICE_INDEX.sortAttribute,
          },
          ExpressionAttributeValues: {
            ':pk': categoryIndexPk(query.categoryId),
            ':from': bounds.from,
            ':to': bounds.to,
          },
          Limit: pageSize(query.limit),
          ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
        }),
      );

      return {
        items: (result.Items ?? []).map(productSummaryFromIndexItem),
        cursor: encodeCursor(result.LastEvaluatedKey),
      };
    },
  };
}
