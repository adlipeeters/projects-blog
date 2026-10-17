/**
 * Idempotency items.
 *
 * Written inside the checkout transaction with `attribute_not_exists(PK)`, so the first request for
 * a key wins and every retry fails that condition. The hash tells a retry of the same request from
 * a key reused for a different one (spec section 7).
 */

import { z } from 'zod';

import { EntityType, SCHEMA_VERSION } from '../entity-types.js';
import { idempotencyKey } from '../keys.js';
import { parseItem } from './parse.js';

const idempotencyItemSchema = z.object({
  entityType: z.literal(EntityType.IdempotencyKey),
  schemaVersion: z.number().int().positive(),
  orderId: z.string(),
  requestHash: z.string().min(1),
});

export type IdempotencyRecord = {
  readonly orderId: string;
  readonly requestHash: string;
};

export const idempotencyToItem = (input: {
  readonly customerId: string;
  readonly key: string;
  readonly orderId: string;
  readonly requestHash: string;
  readonly ttl: number;
}): Record<string, unknown> => ({
  ...idempotencyKey(input.customerId, input.key),
  entityType: EntityType.IdempotencyKey,
  schemaVersion: SCHEMA_VERSION,
  orderId: input.orderId,
  requestHash: input.requestHash,
  ttl: input.ttl,
});

export function idempotencyFromItem(raw: unknown): IdempotencyRecord {
  const item = parseItem(idempotencyItemSchema, EntityType.IdempotencyKey, raw);
  return { orderId: item.orderId, requestHash: item.requestHash };
}
