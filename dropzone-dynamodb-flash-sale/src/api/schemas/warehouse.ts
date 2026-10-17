/**
 * Request and response DTOs for the warehouse queue (AP12).
 */

import { z } from 'zod';

import type { FulfillmentEntry } from '../../domain/order.js';
import { ValidationError } from '../../shared/errors.js';
import { MAX_PAGE_SIZE } from '../../shared/pagination.js';

const queueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export type QueueQueryDto = z.infer<typeof queueQuerySchema>;

export function parseQueueQuery(
  raw: Record<string, string | undefined> | undefined,
): QueueQueryDto {
  const result = queueQuerySchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new ValidationError('Invalid request: limit must be a whole number');
  }
  return result.data;
}

export type QueueEntryDto = {
  readonly orderId: string;
  readonly customerId: string;
  readonly status: string;
  readonly totalCents: number;
  readonly placedAt: string;
};

export type QueueDto = {
  readonly items: readonly QueueEntryDto[];
  /** How many index shards were merged to build this page. */
  readonly shards: number;
};

export const toQueueResponse = (queue: {
  readonly items: readonly FulfillmentEntry[];
  readonly shards: number;
}): QueueDto => ({
  items: queue.items.map((entry) => ({
    orderId: entry.orderId,
    customerId: entry.customerId,
    status: entry.status,
    totalCents: entry.total.amountCents,
    placedAt: entry.placedAt,
  })),
  shards: queue.shards,
});
