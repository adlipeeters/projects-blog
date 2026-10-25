/**
 * The invariant from spec section 9, checked after every load run.
 *
 *   COMMERCE_TABLE=dropzone-dev-commerce pnpm verify-stock -- \
 *     --sku DROP-TEE-M-BLK --units 5000 --since 2026-10-25T14:00:00.000Z
 *
 * Available units, plus units sitting in orders, plus units sitting in HELD holds, must equal what
 * was seeded. Any difference fails the run, and the script exits non-zero so a harness can gate on
 * it.
 *
 * `--since` is the moment the stock was seeded, which `seed-stock` prints for exactly this purpose.
 * Without it the count includes every order the sku ever had, and since seeding overwrites
 * `available` rather than adding to it, those older units are already outside the sum: a table with
 * any history would report a surplus and fail a run that went perfectly.
 *
 * Why those three terms and no others:
 *
 * - a confirmed hold's units are counted once, in the order it became. The hold itself is
 *   CONFIRMED and must not be counted again.
 * - a released hold gave its units back, so they are already in `available`.
 * - a cancelled order gave its units back too, for the same reason.
 *
 * This is the second place in the project that runs a `Scan`, after the section 10 backfill.
 * Nothing indexes orders by sku, and deliberately so: no request needs that, and an index written
 * by every order during a drop is exactly the hot partition the whole exercise is about. A
 * verification job that runs once between load runs can afford to read the table.
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { sku as parseSku } from '../src/domain/ids.js';
import { stockIsConserved } from '../src/domain/stock.js';
import { EntityType } from '../src/persistence/entity-types.js';
import { documentClient } from '../src/persistence/client.js';
import { commerceTable } from '../src/shared/env.js';

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const numberFlag = (name: string, fallback: number): number => {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} needs a non-negative whole number, got ${raw}`);
  }
  return parsed;
};

/** The cutoff, as epoch milliseconds. Orders and holds older than this belong to an earlier run. */
const parseSince = (): number | undefined => {
  const raw = flag('since');
  if (raw === undefined) return undefined;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`--since needs an ISO-8601 timestamp, got ${raw}`);
  }
  return parsed;
};

const allocationSchema = z.object({
  sku: z.string(),
  bucket: z.number().int().nonnegative(),
  qty: z.number().int().positive(),
});

/** Only the attributes this count needs, and all of them optional: a Scan sees every entity. */
const rowSchema = z.object({
  entityType: z.string(),
  status: z.string().optional(),
  sku: z.string().optional(),
  bucket: z.number().int().nonnegative().optional(),
  available: z.number().int().nonnegative().optional(),
  allocations: z.array(allocationSchema).optional(),
  /** An order is dated by when it was placed, a hold by when it was taken. */
  placedAt: z.string().optional(),
  createdAt: z.string().optional(),
});

const table = commerceTable();
const sku = parseSku(flag('sku') ?? 'DROP-TEE-M-BLK');
const initial = numberFlag('units', 500);
const since = parseSince();
const asJson = process.argv.includes('--json');

const tally = {
  available: 0,
  buckets: 0,
  inOrders: 0,
  inHolds: 0,
  /** Counted and excluded on purpose, so the output explains itself when the sum is short. */
  inCancelledOrders: 0,
  inClosedHolds: 0,
  /** Units in orders and holds from before --since, which belong to an earlier seeding. */
  inEarlierRuns: 0,
  rowsScanned: 0,
};

/** Units of this sku across an item's allocations. */
const unitsOf = (allocations: readonly z.infer<typeof allocationSchema>[]): number =>
  allocations
    .filter((allocation) => allocation.sku === sku)
    .reduce((units, allocation) => units + allocation.qty, 0);

let startKey: Record<string, unknown> | undefined;

do {
  const page = await documentClient().send(
    new ScanCommand({
      TableName: table,
      // The filter runs after the read, so it saves bandwidth rather than capacity. Capacity is
      // what a Scan costs, and accepting that is the whole decision above.
      FilterExpression: 'entityType IN (:stock, :order, :hold)',
      ProjectionExpression:
        'entityType, #status, sku, #bucket, #available, allocations, placedAt, createdAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#bucket': 'bucket',
        '#available': 'available',
      },
      ExpressionAttributeValues: {
        ':stock': EntityType.StockBucket,
        ':order': EntityType.Order,
        ':hold': EntityType.Hold,
      },
      ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
    }),
  );

  for (const raw of page.Items ?? []) {
    const row = rowSchema.parse(raw);
    tally.rowsScanned += 1;

    if (row.entityType === EntityType.StockBucket) {
      if (row.sku === sku) {
        tally.available += row.available ?? 0;
        tally.buckets += 1;
      }
      continue;
    }

    const units = unitsOf(row.allocations ?? []);
    if (units === 0) {
      continue;
    }

    if (since !== undefined) {
      const at = Date.parse(row.placedAt ?? row.createdAt ?? '');
      if (Number.isNaN(at) || at < since) {
        tally.inEarlierRuns += units;
        continue;
      }
    }

    if (row.entityType === EntityType.Order) {
      if (row.status === 'CANCELLED') {
        tally.inCancelledOrders += units;
      } else {
        tally.inOrders += units;
      }
      continue;
    }

    if (row.status === 'HELD') {
      tally.inHolds += units;
    } else {
      tally.inClosedHolds += units;
    }
  }

  startKey = page.LastEvaluatedKey;
} while (startKey !== undefined);

const counted = tally.available + tally.inOrders + tally.inHolds;
const conserved = stockIsConserved({
  initial,
  available: tally.available,
  inOrders: tally.inOrders,
  inHolds: tally.inHolds,
});

if (asJson) {
  console.log(
    JSON.stringify(
      {
        table,
        sku,
        initial,
        since: since === undefined ? null : new Date(since).toISOString(),
        counted,
        conserved,
        ...tally,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`${table} ${sku}`);
  if (since !== undefined) {
    console.log(`  counting orders and holds from ${new Date(since).toISOString()} onwards`);
  }
  console.log(
    `  available             ${String(tally.available).padStart(6)}  across ${String(tally.buckets)} bucket(s)`,
  );
  console.log(`  in orders             ${String(tally.inOrders).padStart(6)}`);
  console.log(`  in HELD holds         ${String(tally.inHolds).padStart(6)}`);
  console.log(`  ${'-'.repeat(38)}`);
  console.log(`  counted               ${String(counted).padStart(6)}`);
  console.log(`  seeded                ${String(initial).padStart(6)}`);
  console.log('');
  console.log(
    `  excluded: ${String(tally.inCancelledOrders)} unit(s) in cancelled orders, ${String(tally.inClosedHolds)} in confirmed or released holds.`,
  );
  console.log(`  Those units were credited back and are already inside "available".`);
  if (tally.inEarlierRuns > 0) {
    console.log(
      `  excluded: ${String(tally.inEarlierRuns)} unit(s) from before the cutoff, which belong to an earlier seeding.`,
    );
  }
  console.log('');
  console.log(
    conserved
      ? `  OK: every seeded unit is accounted for (${String(tally.rowsScanned)} rows scanned).`
      : `  FAILED: ${String(counted - initial)} unit(s) unaccounted for. A positive number means units appeared, a negative one means units were lost.`,
  );
}

if (!conserved) {
  process.exit(1);
}
