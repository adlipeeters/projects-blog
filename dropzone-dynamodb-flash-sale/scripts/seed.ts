/**
 * Seeds the catalog: 200 products across five categories, each with variants, plus one drop.
 *
 * Run against DynamoDB Local or a deployed table:
 *
 *   CATALOG_TABLE=dropzone-dev-catalog pnpm seed
 *   CATALOG_TABLE=dropzone-dev-catalog pnpm seed -- --drop-units 500
 *
 * Deterministic on purpose, ids included. The load runs in section 9 compare two configurations of
 * the same drop, so the catalog has to be identical between them, and reseeding has to overwrite
 * the same items rather than mint a second set under new ids.
 */

import { monotonicFactory } from 'ulid';

import { categoryId, productId as toProductId, sku } from '../src/domain/ids.js';
import { money } from '../src/domain/money.js';
import type { Product, Variant } from '../src/domain/product.js';
import { DEFAULT_STOCK_BUCKETS, DROP_STOCK_BUCKETS } from '../src/domain/product.js';
import { catalogRepository } from '../src/persistence/repositories/catalog.js';
import { catalogTable } from '../src/shared/env.js';

const CATEGORIES = ['tees', 'hoodies', 'caps', 'jackets', 'socks'] as const;
const SIZES = ['S', 'M', 'L', 'XL'] as const;
const COLORS = ['BLK', 'WHT', 'GRY'] as const;
const PRODUCTS_PER_CATEGORY = 40;

/**
 * A tiny deterministic generator, so a reseed produces the same catalog without pulling in a
 * dependency. Mulberry32.
 */
const randomFrom = (seed: number) => {
  let state = seed;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const flagValue = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const raw = process.argv[index + 1];
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} needs a positive whole number, got ${String(raw)}`);
  }
  return parsed;
};

/**
 * Catalog ids are ULIDs like every other id, but seeded ones come from a fixed clock and a seeded
 * generator, so `pnpm seed` twice writes the same ids and therefore the same items.
 */
const SEED_EPOCH_MS = Date.parse('2026-10-15T00:00:00.000Z');

async function main(): Promise<void> {
  const table = catalogTable();
  const catalog = catalogRepository();
  const random = randomFrom(20261015);
  const seededUlid = monotonicFactory(randomFrom(20261016));
  const nextProductId = (): ReturnType<typeof toProductId> =>
    toProductId(seededUlid(SEED_EPOCH_MS));
  const dropUnits = flagValue('drop-units', 500);

  console.log(`Seeding ${table}`);

  let products = 0;
  let variants = 0;

  for (const category of CATEGORIES) {
    for (let n = 0; n < PRODUCTS_PER_CATEGORY; n += 1) {
      // 19.99 to 149.99, in whole euros so the price range queries read nicely.
      const basePriceCents = (20 + Math.floor(random() * 130)) * 100 - 1;
      const productId = nextProductId();
      const code = `${category.slice(0, 3).toUpperCase()}${String(n).padStart(3, '0')}`;

      const product: Product = {
        productId,
        name: `${category.slice(0, -1)} ${code}`,
        description: `Seeded ${category} product for the Dropzone catalog.`,
        categoryId: categoryId(category),
        fromPrice: money(basePriceCents),
        imageUrl: `https://images.example.test/${category}/${code}.jpg`,
        isDrop: false,
      };

      const productVariants: Variant[] = SIZES.map((size, index) => ({
        productId,
        sku: sku(`${code}-${size}-${COLORS[index % COLORS.length] ?? 'BLK'}`),
        size,
        color: COLORS[index % COLORS.length] ?? 'BLK',
        // Larger sizes cost a little more, which gives the price index something to sort.
        price: money(basePriceCents + index * 500),
        stockBuckets: DEFAULT_STOCK_BUCKETS,
      }));

      await catalog.putProduct(product, productVariants);
      products += 1;
      variants += productVariants.length;

      // The catalog table is provisioned, so a seed is capacity-bound rather than CPU-bound. The
      // repository retries what the table could not take; this just shows progress.
      if (products % 20 === 0) {
        console.log(`  ${String(products)} products written`);
      }
    }
  }

  // The flash-sale product. Its single variant is the one the load test fights over, and the
  // bucket count is what run A and run B of section 9 differ in.
  const dropId = nextProductId();
  const drop: Product = {
    productId: dropId,
    name: 'Dropzone Drop Tee',
    description: `Limited release. ${String(dropUnits)} units.`,
    categoryId: categoryId('tees'),
    fromPrice: money(5999),
    imageUrl: 'https://images.example.test/tees/DROP.jpg',
    isDrop: true,
  };

  const dropVariant: Variant = {
    productId: dropId,
    sku: sku('DROP-TEE-M-BLK'),
    size: 'M',
    color: 'BLK',
    price: money(5999),
    stockBuckets: DROP_STOCK_BUCKETS,
  };

  await catalog.putProduct(drop, [dropVariant]);
  products += 1;
  variants += 1;

  console.log(
    `Seeded ${String(products)} products and ${String(variants)} variants. Drop sku ${dropVariant.sku} across ${String(DROP_STOCK_BUCKETS)} buckets, ${String(dropUnits)} units to be written by the stock seed in M6.`,
  );
}

await main();
