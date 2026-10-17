/**
 * Prints a sku's buckets and their sum.
 *
 *   COMMERCE_TABLE=dropzone-dev-commerce pnpm stock-report -- --sku DROP-TEE-M-BLK --buckets 10
 *
 * The full invariant check (available + sold + held = initial) arrives with the holds in M6, as
 * scripts/verify-stock.ts.
 */

import { sku as parseSku } from '../src/domain/ids.js';
import { stockRepository } from '../src/persistence/repositories/stock.js';
import { commerceTable } from '../src/shared/env.js';

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const sku = parseSku(flag('sku') ?? 'DROP-TEE-M-BLK');
const buckets = Number(flag('buckets') ?? '10');

const found = await stockRepository().readBuckets(sku, buckets);
const total = found.reduce((sum, bucket) => sum + bucket.available, 0);

console.log(`${commerceTable()} ${sku}`);
for (const bucket of found) {
  console.log(
    `  bucket ${String(bucket.bucket).padStart(2, '0')}: ${String(bucket.available)} available, version ${String(bucket.version)}`,
  );
}
console.log(`  total available: ${String(total)}`);
