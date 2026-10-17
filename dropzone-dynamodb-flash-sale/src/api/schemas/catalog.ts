/**
 * Request and response DTOs for the catalog routes.
 *
 * Requests are validated here; responses are built from domain objects, never from raw items
 * (spec section 3). The wire shape is therefore free to differ from both the item and the domain,
 * which is the point of having three layers.
 */

import { z } from 'zod';

import { categoryId, productId } from '../../domain/ids.js';
import type { Money } from '../../domain/money.js';
import type { Product, ProductSummary, Variant } from '../../domain/product.js';
import { ValidationError } from '../../shared/errors.js';
import { MAX_PAGE_SIZE, type Page } from '../../shared/pagination.js';

/** Query strings arrive as strings, so numbers are coerced and then checked. */
const listCategoryQuerySchema = z.object({
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
});

export type ListCategoryQuery = z.infer<typeof listCategoryQuerySchema>;

const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Invalid request: ${issue === undefined ? 'unknown field' : `${issue.path.join('.')} ${issue.message.toLowerCase()}`}`,
    );
  }
  return result.data;
};

export const parseProductIdPath = (raw: string | undefined) => productId(raw ?? '');

export const parseCategoryIdPath = (raw: string | undefined) => categoryId(raw ?? '');

export function parseListCategoryQuery(
  raw: Record<string, string | undefined> | undefined,
): ListCategoryQuery {
  const query = parse(listCategoryQuerySchema, raw ?? {});

  if (
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    query.maxPrice < query.minPrice
  ) {
    throw new ValidationError('maxPrice must not be lower than minPrice', {
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
    });
  }

  return query;
}

// --- responses ---

type MoneyDto = { readonly amountCents: number; readonly currency: string };

const toMoney = (amount: Money): MoneyDto => ({
  amountCents: amount.amountCents,
  currency: amount.currency,
});

export type VariantDto = {
  readonly sku: string;
  readonly size: string;
  readonly color: string;
  readonly price: MoneyDto;
};

export type ProductDto = {
  readonly productId: string;
  readonly name: string;
  readonly description: string;
  readonly categoryId: string;
  readonly fromPrice: MoneyDto;
  readonly imageUrl: string;
  readonly isDrop: boolean;
  readonly variants: readonly VariantDto[];
};

/**
 * `stockBuckets` is deliberately not exposed: how stock is sharded is an implementation detail,
 * and publishing it would invite a client to depend on it.
 */
export const toProductResponse = (product: Product, variants: readonly Variant[]): ProductDto => ({
  productId: product.productId,
  name: product.name,
  description: product.description,
  categoryId: product.categoryId,
  fromPrice: toMoney(product.fromPrice),
  imageUrl: product.imageUrl,
  isDrop: product.isDrop,
  variants: variants.map((variant) => ({
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    price: toMoney(variant.price),
  })),
});

export type ProductSummaryDto = {
  readonly productId: string;
  readonly name: string;
  readonly fromPrice: MoneyDto;
  readonly imageUrl: string;
};

export type CategoryListingDto = {
  readonly items: readonly ProductSummaryDto[];
  /** Pass back as `cursor` for the next page. Null on the last page. */
  readonly nextCursor: string | null;
};

export const toCategoryListingResponse = (page: Page<ProductSummary>): CategoryListingDto => ({
  items: page.items.map((item) => ({
    productId: item.productId,
    name: item.name,
    fromPrice: toMoney(item.fromPrice),
    imageUrl: item.imageUrl,
  })),
  nextCursor: page.cursor,
});
