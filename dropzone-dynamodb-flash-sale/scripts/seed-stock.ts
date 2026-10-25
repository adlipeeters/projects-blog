/**
 * Seeds stock for one sku: splits the units across its buckets, and tells the catalog how many
 * buckets there are.
 *
 *   COMMERCE_TABLE=dropzone-dev-commerce CATALOG_TABLE=dropzone-dev-catalog \
 *   pnpm seed-stock -- --sku DROP-TEE-M-BLK --units 5000 --buckets 10
 *
 * Run A and run B of section 9 differ only in --buckets, which is the point of the experiment.
 * That means the flag has to do both halves of the job: the stock items hold the units, and the
 * variant's `stockBuckets` is what checkout and create-hold actually rotate over. Writing the
 * items without updating the variant would leave every request walking ten buckets when only one
 * was seeded, which measures wasted rotations rather than a hot partition.
 *
 * Not atomic, and it does not need to be: nothing should be buying while a drop is being seeded.
 *
 * It refuses to run while any hold is still open, and that guard is not pedantry. Seeding
 * overwrites `available` instead of adding to it, so an open hold's units are already outside the
 * new total. When the sweeper releases that hold a few minutes later it credits them back, and the
 * table ends up with stock that was never seeded: a load run's invariant check then fails for a
 * reason that has nothing to do with the run. `--force` skips the guard.
 */

import { sku as parseSku } from '../src/domain/ids.js';
import { catalogRepository } from '../src/persistence/repositories/catalog.js';
import { holdRepository } from '../src/persistence/repositories/holds.js';
import { stockRepository } from '../src/persistence/repositories/stock.js';
import { catalogTable, commerceTable } from '../src/shared/env.js';

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

const sku = parseSku(flag('sku') ?? 'DROP-TEE-M-BLK');
const units = numberFlag('units', 500);
const buckets = numberFlag('buckets', 10);

if (!process.argv.includes('--force')) {
  const open = await holdRepository().openHolds();
  if (open.items.length > 0) {
    const soonest = open.items.map((hold) => hold.expiresAt).sort()[0] ?? 'unknown';
    const latest =
      open.items
        .map((hold) => hold.expiresAt)
        .sort()
        .at(-1) ?? 'unknown';
    throw new Error(
      [
        `${String(open.items.length)} hold(s) are still open, expiring between ${soonest} and ${latest}.`,
        'Seeding now would leave their units to be credited back by the sweeper after the seed,',
        'which invents stock that was never seeded and fails the next invariant check.',
        'Wait for the sweeper to release them, or pass --force if you know why that is safe.',
      ].join('\n'),
    );
  }
}

const written = await stockRepository().seed(sku, units, buckets);

// Second, so there is never a moment where the variant points at buckets that hold nothing.
await catalogRepository().setStockBuckets(sku, buckets);

const seededAt = new Date().toISOString();

console.log(
  `${commerceTable()}: ${sku} seeded with ${String(units)} units across ${String(buckets)} bucket(s): ${written
    .map((bucket) => `${String(bucket.bucket)}=${String(bucket.available)}`)
    .join(' ')}`,
);
console.log(`${catalogTable()}: ${sku} stockBuckets set to ${String(buckets)}`);
console.log('');
console.log(`Seeded at ${seededAt}`);
console.log(`Check the invariant after the run with:`);
console.log(`  pnpm verify-stock -- --sku ${sku} --units ${String(units)} --since ${seededAt}`);
