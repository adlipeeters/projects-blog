/**
 * Prints a sku's buckets and their sum.
 *
 *   COMMERCE_TABLE=dropzone-dev-commerce CATALOG_TABLE=dropzone-dev-catalog \
 *   pnpm stock-report -- --sku DROP-TEE-M-BLK
 *
 * The bucket count comes from the variant, the same way checkout and create-hold get it, rather
 * than from a flag that can disagree with the catalog. A report that says ten buckets while the
 * allocator is rotating over one is worse than no report.
 *
 * The full invariant check is scripts/verify-stock.ts.
 */

import { sku as parseSku } from '../src/domain/ids.js';
import { stockRepository } from '../src/persistence/repositories/stock.js';
import { commerceTable } from '../src/shared/env.js';

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const sku = parseSku(flag('sku') ?? 'DROP-TEE-M-BLK');

const stock = await stockRepository().forSku(sku);

console.log(`${commerceTable()} ${sku}`);
for (const bucket of stock.buckets) {
  console.log(
    `  bucket ${String(bucket.bucket).padStart(2, '0')}: ${String(bucket.available)} available, version ${String(bucket.version)}`,
  );
}
console.log(`  total available: ${String(stock.available)}`);
console.log(`  buckets the allocator rotates over: ${String(stock.buckets.length)}`);
