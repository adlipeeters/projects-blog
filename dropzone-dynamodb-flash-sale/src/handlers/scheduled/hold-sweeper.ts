/**
 * The hold sweeper: EventBridge Scheduler, every minute (AP15).
 *
 * This is the job TTL cannot do. DynamoDB deletes expired items within a few days of their TTL, not
 * on the second, so leaving stock in an expired hold until TTL fires would take units off sale for
 * days. The sweeper returns them in about a minute, and the `expiresAt <= :now` condition on its
 * release means it can never take a hold the customer is still allowed to confirm.
 *
 * It reads four index shards, releases what it finds, and treats a hold that was confirmed or
 * released in the meantime as a normal outcome rather than an error: under load that race is the
 * common case, not the exception.
 */

import type { Context } from 'aws-lambda';

import { holdRepository } from '../../persistence/repositories/holds.js';
import { scheduledJob } from '../../shared/job.js';
import { logger } from '../../shared/logger.js';
import { MetricName, count } from '../../shared/metrics.js';

const holds = holdRepository();

/**
 * How many expired holds to take from each shard per run.
 *
 * Four shards, so up to 100 releases in one invocation. A backlog drains over the following runs
 * rather than in one burst, which keeps a minute's work bounded and predictable.
 */
const PER_SHARD = 25;

/**
 * How long after expiry a hold still being HELD stops being normal.
 *
 * The sweeper runs every minute, so a hold that expired within the last minute is simply waiting
 * its turn. Two minutes means a run was missed or its releases are failing, which is what the
 * `HoldExpiredUnreleased` alarm watches for (spec section 11).
 */
const LATE_AFTER_MS = 2 * 60_000;

export type SweepReport = {
  readonly found: number;
  readonly released: number;
  readonly alreadyResolved: number;
  readonly failed: number;
  readonly late: number;
  readonly shards: number;
};

export const handler = scheduledJob(
  'hold-sweeper',
  async (_event: unknown, _context: Context): Promise<SweepReport> => {
    const now = new Date();
    const expired = await holds.expiredHolds(now, PER_SHARD);

    const outcomes = await Promise.allSettled(
      expired.items.map((entry) =>
        holds.releaseHold(entry.customerId, entry.holdId, { expiredOnly: true }, now),
      ),
    );

    let released = 0;
    let alreadyResolved = 0;
    let failed = 0;

    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'rejected') {
        failed += 1;
        // Logged and left for the next run. A release that keeps failing shows up as a hold that
        // stays expired, which is what the late count below measures.
        logger.error('Could not release an expired hold', {
          holdId: expired.items[index]?.holdId,
          error: outcome.reason as Error,
        });
        continue;
      }

      if (outcome.value.kind === 'released') {
        released += 1;
      } else {
        alreadyResolved += 1;
      }
    }

    const late = expired.items.filter(
      (entry) => now.getTime() - Date.parse(entry.expiresAt) > LATE_AFTER_MS,
    ).length;

    // Emitted every run, including as zero. A metric that is only published when something is
    // wrong leaves its alarm in INSUFFICIENT_DATA, which looks the same as healthy.
    count(MetricName.HoldsReleasedBySweeper, released);
    count(MetricName.HoldExpiredUnreleased, late);

    const report: SweepReport = {
      found: expired.items.length,
      released,
      alreadyResolved,
      failed,
      late,
      shards: expired.shards,
    };

    logger.info('Hold sweep finished', { ...report });
    return report;
  },
);
