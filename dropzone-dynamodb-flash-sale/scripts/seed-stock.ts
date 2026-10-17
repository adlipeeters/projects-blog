/**
 * Seeds stock for one sku, split evenly across its buckets.
 *
 *   COMMERCE_TABLE=dropzone-dev-commerce pnpm seed-stock -- --sku DROP-TEE-M-BLK --units 500 --buckets 10
 *
 * Run A and run B of section 9 differ only in --buckets, which is the point of the experiment.
 */

import { sku as parseSku } from '../src/domain/ids.js';
import { stockRepository } from '../src/persistence/repositories/stock.js';
import { commerceTable } from '../src/shared/env.js';

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const numberFlag = (name: string, fallback: number): number => {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} needs a positive whole number, got ${raw}`);
  }
  return parsed;
};

const table = commerceTable();
const sku = parseSku(flag('sku') ?? 'DROP-TEE-M-BLK');
const units = numberFlag('units', 500);
const buckets = numberFlag('buckets', 10);

const written = await stockRepository().seed(sku, units, buckets);

console.log(
  `${table}: ${sku} seeded with ${String(units)} units across ${String(buckets)} bucket(s): ${written
    .map((bucket) => `${String(bucket.bucket)}=${String(bucket.available)}`)
    .join(' ')}`,
);
