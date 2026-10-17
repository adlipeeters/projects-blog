/**
 * BatchWriteItem, done properly.
 *
 * Two things make a naive batch write lose data, and a provisioned table hits both:
 *
 * - A partial success returns HTTP 200 with the writes it did not perform in `UnprocessedItems`.
 *   Ignoring that field drops items silently.
 * - When the table has no capacity at all, the whole request is rejected with
 *   `ProvisionedThroughputExceededException` once the SDK's own retries are exhausted.
 *
 * Both mean "come back later", so both are retried here with jittered exponential backoff. Jitter
 * matters because every caller backing off by the same fixed delay collides again on the next try.
 */

import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

import { documentClient } from './client.js';

/** BatchWriteItem takes at most 25 requests per call. */
export const BATCH_LIMIT = 25;

const MAX_ATTEMPTS = 14;

const THROTTLE_ERRORS = new Set([
  'ProvisionedThroughputExceededException',
  'ThrottlingException',
  'RequestLimitExceeded',
]);

const isThrottle = (error: unknown): boolean =>
  error instanceof Error && THROTTLE_ERRORS.has(error.name);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const backoffMs = (attempt: number): number =>
  Math.min(2 ** attempt * 50, 5_000) * (0.5 + Math.random());

export type WriteRequest =
  | { PutRequest: { Item: Record<string, unknown> } }
  | { DeleteRequest: { Key: Record<string, unknown> } };

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/** Writes every request, retrying until the table has accepted all of them. */
export async function batchWriteAll(
  table: string,
  requests: readonly WriteRequest[],
): Promise<number> {
  for (const batch of chunk(requests, BATCH_LIMIT)) {
    let pending: WriteRequest[] = [...batch];

    for (let attempt = 0; pending.length > 0; attempt += 1) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(
          `Gave up writing ${String(pending.length)} items to ${table} after ${String(attempt)} attempts`,
        );
      }
      if (attempt > 0) {
        await sleep(backoffMs(attempt));
      }

      try {
        const result = await documentClient().send(
          new BatchWriteCommand({ RequestItems: { [table]: pending } }),
        );
        pending = (result.UnprocessedItems?.[table] ?? []) as WriteRequest[];
      } catch (error: unknown) {
        if (!isThrottle(error)) {
          throw error;
        }
        // Nothing was written, so `pending` stays as it is and the next attempt waits longer.
      }
    }
  }

  return requests.length;
}
