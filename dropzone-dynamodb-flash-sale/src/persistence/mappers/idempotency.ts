/**
 * Idempotency items.
 *
 * Written inside the checkout or create-hold transaction with `attribute_not_exists(PK)`, so the
 * first request for a key wins and every retry fails that condition. The hash tells a retry of the
 * same request from a key reused for a different one (spec section 7).
 *
 * The item records which entity the first request created, under the attribute that names it:
 * `orderId` for checkout and confirm, `holdId` for create-hold. Two attributes rather than one
 * generic `entityId`, because items written before holds existed say `orderId` and still have to
 * parse.
 */

import { z } from 'zod';

import { EntityType, SCHEMA_VERSION } from '../entity-types.js';
import { idempotencyKey } from '../keys.js';
import { parseItem } from './parse.js';

const idempotencyItemSchema = z
  .object({
    entityType: z.literal(EntityType.IdempotencyKey),
    schemaVersion: z.number().int().positive(),
    orderId: z.string().optional(),
    holdId: z.string().optional(),
    requestHash: z.string().min(1),
  })
  .refine((item) => item.orderId !== undefined || item.holdId !== undefined, {
    message: 'an idempotency item must name the entity it created',
  });

export type IdempotencyRecord = {
  /** The order or hold the first request with this key created. */
  readonly entityId: string;
  readonly kind: 'order' | 'hold';
  readonly requestHash: string;
};

/** Exactly one of the two, so an item can never claim to have created both. */
export type IdempotencyTarget = { readonly orderId: string } | { readonly holdId: string };

export const idempotencyToItem = (
  input: {
    readonly customerId: string;
    readonly key: string;
    readonly requestHash: string;
    readonly ttl: number;
  } & IdempotencyTarget,
): Record<string, unknown> => ({
  ...idempotencyKey(input.customerId, input.key),
  entityType: EntityType.IdempotencyKey,
  schemaVersion: SCHEMA_VERSION,
  ...('orderId' in input ? { orderId: input.orderId } : { holdId: input.holdId }),
  requestHash: input.requestHash,
  ttl: input.ttl,
});

export function idempotencyFromItem(raw: unknown): IdempotencyRecord {
  const item = parseItem(idempotencyItemSchema, EntityType.IdempotencyKey, raw);

  return item.orderId === undefined
    ? { entityId: item.holdId as string, kind: 'hold', requestHash: item.requestHash }
    : { entityId: item.orderId, kind: 'order', requestHash: item.requestHash };
}
