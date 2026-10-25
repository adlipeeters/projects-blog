/**
 * The drop: the headline experiment from spec section 9.
 *
 *   COMMERCE_TABLE=dropzone-dev-commerce CATALOG_TABLE=dropzone-dev-catalog \
 *   DYNAMODB_MAX_SOCKETS=400 pnpm load -- --sku DROP-TEE-M-BLK --concurrency 400 --label runA
 *
 * Run A seeds the sku with one stock bucket, run B with ten. Everything else is identical, which
 * is what makes the two sets of numbers an argument rather than an anecdote.
 *
 * The driver holds a fixed number of buyers in flight and stops at whichever comes first: the
 * drop sells out, the deadline passes, or the attempt cap is reached. Each slot runs buyers back to
 * back, so the offered rate is concurrency divided by latency and rises as the table gets faster,
 * which is the behaviour a real queue of shoppers has.
 *
 * What this cannot show: nothing but DynamoDB throttles in this path, so there are no API Gateway
 * 429s and no Lambda throttles in the output. Server-side latency and throttle counts come from
 * CloudWatch, where they do not depend on where the client was sitting.
 */

import { writeFile } from 'node:fs/promises';

import { sku as parseSku } from '../../src/domain/ids.js';
import { stockRepository } from '../../src/persistence/repositories/stock.js';
import { commerceTable } from '../../src/shared/env.js';
import { type Attempt, type Outcome, buyOne } from './worker.js';

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
const qty = numberFlag('qty', 1);
const concurrency = numberFlag('concurrency', 400);
const durationSeconds = numberFlag('duration', 120);
const maxAttempts = numberFlag('max-attempts', 200_000);
const label = flag('label') ?? 'run';
const out = flag('out');

/**
 * When to call the drop over.
 *
 * A single sold-out answer is not proof: under contention a request can exhaust its bucket
 * rotation while units are still left elsewhere. Once as many requests as there are slots have been
 * told the drop is empty, it is empty.
 */
const soldOutThreshold = concurrency;

const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
};

const attempts: Attempt[] = [];
const outcomes: Record<Outcome, number> = {
  confirmed: 0,
  soldOut: 0,
  conflict: 0,
  expired: 0,
  error: 0,
};

let stopping = false;
let started = 0;
let firstSoldOutAt: number | undefined;

const stop = (reason: string): void => {
  if (!stopping) {
    stopping = true;
    console.error(`stopping: ${reason}`);
  }
};

// A stopped task still has to report. Without this, `aws ecs stop-task` would throw the run away.
process.on('SIGTERM', () => {
  stop('SIGTERM');
});
process.on('SIGINT', () => {
  stop('SIGINT');
});

/**
 * Set when the run starts rather than when this module loads, so a slow cold start is not counted
 * against the deadline.
 */
let deadline = 0;
let runStarted = 0;

/** One slot: buyers back to back until something says to stop. */
async function slot(): Promise<void> {
  while (!stopping) {
    if (Date.now() >= deadline) {
      stop('deadline reached');
      return;
    }
    if (started >= maxAttempts) {
      stop('attempt cap reached');
      return;
    }

    started += 1;
    const attempt = await buyOne({ sku, qty, attempt: started });

    attempts.push(attempt);
    outcomes[attempt.outcome] += 1;

    if (attempt.outcome === 'soldOut') {
      firstSoldOutAt ??= performance.now();
      if (outcomes.soldOut >= soldOutThreshold) {
        stop('sold out');
      }
    }
  }
}

async function main(): Promise<void> {
  deadline = Date.now() + durationSeconds * 1000;
  runStarted = performance.now();
  const startedAtIso = new Date().toISOString();

  console.error(
    `${label}: ${String(concurrency)} in flight on ${sku}, up to ${String(durationSeconds)}s, table ${commerceTable()}`,
  );

  await Promise.all(Array.from({ length: concurrency }, () => slot()));

  const wallSeconds = Math.round(((performance.now() - runStarted) / 1000) * 1000) / 1000;
  const totals = [...attempts.map((a) => a.totalMs)].sort((left, right) => left - right);
  const holdTimes = [...attempts.map((a) => a.holdMs)]
    .filter((ms) => ms > 0)
    .sort((left, right) => left - right);

  /** Which bucket served each confirmed purchase. With one bucket this is the whole story. */
  const byBucket: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.outcome === 'confirmed' && attempt.bucket !== undefined) {
      const key = String(attempt.bucket);
      byBucket[key] = (byBucket[key] ?? 0) + 1;
    }
  }

  /** Error codes seen, so a run that went wrong says why without reading every attempt. */
  const codes: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.code !== undefined) {
      codes[attempt.code] = (codes[attempt.code] ?? 0) + 1;
    }
  }

  // What is left, read after the run. Never at the cost of the run's own numbers.
  const remaining = await stockRepository()
    .forSku(sku)
    .catch((error: unknown) => {
      console.error(`could not read the remaining stock: ${String(error)}`);
      return undefined;
    });

  const summary = {
    label,
    sku,
    qty,
    concurrency,
    table: commerceTable(),
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    wallSeconds,
    attempts: attempts.length,
    ...outcomes,
    unitsSold: outcomes.confirmed * qty,
    timeToSoldOutSeconds:
      firstSoldOutAt === undefined
        ? null
        : Math.round(((firstSoldOutAt - runStarted) / 1000) * 1000) / 1000,
    attemptsPerSecond: Math.round((attempts.length / wallSeconds) * 100) / 100,
    confirmedPerSecond: Math.round((outcomes.confirmed / wallSeconds) * 100) / 100,
    latencyMs: {
      totalP50: percentile(totals, 0.5),
      totalP95: percentile(totals, 0.95),
      totalP99: percentile(totals, 0.99),
      totalMax: totals.at(-1) ?? 0,
      holdP50: percentile(holdTimes, 0.5),
      holdP95: percentile(holdTimes, 0.95),
      holdP99: percentile(holdTimes, 0.99),
    },
    confirmedByBucket: byBucket,
    codes,
    availableAfter: remaining?.available ?? null,
    bucketsAfter: remaining?.buckets.map((bucket) => bucket.available) ?? null,
  };

  if (out !== undefined) {
    await writeFile(out, `${JSON.stringify({ summary, attempts }, null, 2)}\n`, 'utf8');
    console.error(`per-attempt records written to ${out}`);
  }

  // One line, so a log stream can be grepped for it and the results table filled from the JSON.
  console.log(`RESULT ${JSON.stringify(summary)}`);
}

// No top-level await: the harness is bundled as CommonJS, same as the handlers, which keeps it
// clear of the dynamic-require problems an ESM bundle of the AWS SDK runs into.
main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
