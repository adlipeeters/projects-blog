/**
 * AP1 and AP2 against DynamoDB Local.
 *
 * | AP  | Access pattern                                          | Operation                       |
 * | --- | ------------------------------------------------------- | ------------------------------- |
 * | AP1 | Get a product with all its variants                     | Query PK = PRODUCT#<productId>  |
 * | AP2 | List products in a category by price range, cheapest first | Query category-price-index   |
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { categoryId, newProductId, sku } from '../../src/domain/ids.js';
import { money } from '../../src/domain/money.js';
import type { Product, Variant } from '../../src/domain/product.js';
import { DROP_STOCK_BUCKETS } from '../../src/domain/product.js';
import { catalogRepository } from '../../src/persistence/repositories/catalog.js';
import { startHarness, type Harness } from './support/harness.js';

let harness: Harness;
let catalog: ReturnType<typeof catalogRepository>;

const TEES = categoryId('tees');
const HOODIES = categoryId('hoodies');
// Its own category, so the products written by the AP1 group above cannot appear in these
// listings. One container is shared by the whole file, which is the cheap way to run it.
const RANGE = categoryId('range-tees');

const aProduct = (overrides: Partial<Product> = {}): Product => ({
  productId: newProductId(),
  name: 'Dropzone Logo Tee',
  description: 'Heavyweight cotton, boxy fit.',
  categoryId: TEES,
  fromPrice: money(4999),
  imageUrl: 'https://example.test/tee.jpg',
  isDrop: false,
  ...overrides,
});

const aVariant = (product: Product, suffix: string, priceCents: number): Variant => ({
  productId: product.productId,
  sku: sku(`TEE-${suffix}`),
  size: suffix,
  color: 'BLK',
  price: money(priceCents),
  stockBuckets: 1,
});

beforeAll(async () => {
  harness = await startHarness('dropzone-test-catalog');
  catalog = catalogRepository();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe('AP1: get a product with all its variants', () => {
  it('returns the product and its variants from one partition', async () => {
    const product = aProduct({ isDrop: true });
    const variants = [aVariant(product, 'M', 4999), aVariant(product, 'L', 5499)];

    await catalog.putProduct(product, variants);

    const found = await catalog.getProduct(product.productId);

    expect(found).not.toBeNull();
    expect(found?.product.name).toBe('Dropzone Logo Tee');
    expect(found?.product.fromPrice).toEqual(money(4999));
    expect(found?.product.isDrop).toBe(true);

    // Sorted by sku, because SK = VARIANT#<sku> and a Query returns sort key order.
    expect(found?.variants.map((variant) => variant.sku)).toEqual(['TEE-L', 'TEE-M']);
    expect(found?.variants[0]?.price).toEqual(money(5499));
  });

  it('returns null for a product that does not exist', async () => {
    expect(await catalog.getProduct(newProductId())).toBeNull();
  });

  it('keeps a drop variant on more stock buckets than a normal one', async () => {
    const product = aProduct();
    const normal = aVariant(product, 'S', 4999);
    const drop: Variant = { ...aVariant(product, 'XL', 4999), stockBuckets: DROP_STOCK_BUCKETS };

    await catalog.putProduct(product, [normal, drop]);

    const found = await catalog.getProduct(product.productId);
    const bySku = new Map(found?.variants.map((variant) => [variant.sku, variant]));

    expect(bySku.get(sku('TEE-S'))?.stockBuckets).toBe(1);
    expect(bySku.get(sku('TEE-XL'))?.stockBuckets).toBe(10);
  });
});

/**
 * The one dial the two load runs turn (spec section 9).
 *
 * It lives on the variant because that is where checkout and create-hold read it. Splitting the
 * stock items a different way without moving this leaves every request rotating over buckets that
 * were never seeded, which is a different experiment from the one the article claims to run.
 */
describe('stock bucket count', () => {
  // Its own category, so the counts the AP2 listings assert on stay untouched.
  const BUCKETS = categoryId('bucket-tees');

  const aBucketVariant = async (suffix: string) => {
    const product = aProduct({ categoryId: BUCKETS, isDrop: true });
    const variant = aVariant(product, suffix, 2199);
    await catalog.putProduct(product, [variant]);
    return {
      product,
      variant,
      pointer: { sku: variant.sku, productId: product.productId, categoryId: BUCKETS },
    };
  };

  it('sets the count checkout will rotate over', async () => {
    const { variant, pointer } = await aBucketVariant('BUCKETS');

    const before = await catalog.loadVariants([pointer]);
    expect(before.get(variant.sku)?.stockBuckets).toBe(1);

    await catalog.setStockBuckets(variant.sku, DROP_STOCK_BUCKETS);

    const after = await catalog.loadVariants([pointer]);
    expect(after.get(variant.sku)?.stockBuckets).toBe(DROP_STOCK_BUCKETS);
  });

  it('refuses a sku that is not in the catalog', async () => {
    await expect(catalog.setStockBuckets(sku('NOT-A-SKU'), 10)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses a count below one', async () => {
    const { variant } = await aBucketVariant('ZERO');

    await expect(catalog.setStockBuckets(variant.sku, 0)).rejects.toThrow('positive integer');
  });
});

describe('AP2: list a category by price range, cheapest first', () => {
  const cheap = aProduct({ name: 'Cheap tee', categoryId: RANGE, fromPrice: money(1999) });
  const mid = aProduct({ name: 'Mid tee', categoryId: RANGE, fromPrice: money(4999) });
  const dear = aProduct({ name: 'Dear tee', categoryId: RANGE, fromPrice: money(9999) });
  const other = aProduct({ name: 'A hoodie', categoryId: HOODIES, fromPrice: money(4999) });

  beforeAll(async () => {
    for (const product of [dear, cheap, mid, other]) {
      await catalog.putProduct(product, [aVariant(product, 'M', product.fromPrice.amountCents)]);
    }
  });

  it('returns products in price order, not insertion order', async () => {
    const page = await catalog.listCategory({ categoryId: RANGE });

    expect(page.items.map((item) => item.name)).toEqual(['Cheap tee', 'Mid tee', 'Dear tee']);
    // The index projects three attributes, and this is what a listing can show.
    expect(page.items[0]).toEqual({
      productId: cheap.productId,
      name: 'Cheap tee',
      fromPrice: money(1999),
      imageUrl: 'https://example.test/tee.jpg',
    });
  });

  it('filters by an inclusive price range', async () => {
    const page = await catalog.listCategory({
      categoryId: RANGE,
      minPriceCents: 1999,
      maxPriceCents: 4999,
    });

    expect(page.items.map((item) => item.name)).toEqual(['Cheap tee', 'Mid tee']);

    const exact = await catalog.listCategory({
      categoryId: RANGE,
      minPriceCents: 4999,
      maxPriceCents: 4999,
    });

    // Both bounds are inclusive, so a product priced exactly at the bound is in the result.
    expect(exact.items.map((item) => item.name)).toEqual(['Mid tee']);
  });

  it('keeps categories apart', async () => {
    const page = await catalog.listCategory({ categoryId: HOODIES });

    expect(page.items.map((item) => item.name)).toEqual(['A hoodie']);
  });

  it('never returns variants, because the index is sparse', async () => {
    const page = await catalog.listCategory({ categoryId: RANGE });

    // Variants carry no GSI1PK at all, so they cannot appear here. Three products were written
    // into this category with one variant each; a non-sparse index would return six rows.
    expect(page.items).toHaveLength(3);
  });

  it('pages with an opaque cursor', async () => {
    const first = await catalog.listCategory({ categoryId: RANGE, limit: 2 });

    expect(first.items.map((item) => item.name)).toEqual(['Cheap tee', 'Mid tee']);
    expect(first.cursor).toBeTypeOf('string');

    expect(first.cursor).not.toBeNull();

    const second = await catalog.listCategory({
      categoryId: RANGE,
      limit: 2,
      ...(first.cursor === null ? {} : { cursor: first.cursor }),
    });

    expect(second.items.map((item) => item.name)).toEqual(['Dear tee']);
    expect(second.cursor).toBeNull();
  });

  it('rejects a cursor that has been tampered with', async () => {
    await expect(
      catalog.listCategory({ categoryId: RANGE, cursor: 'bm90LWEtY3Vyc29y' }),
    ).rejects.toThrow('cursor');
  });
});
