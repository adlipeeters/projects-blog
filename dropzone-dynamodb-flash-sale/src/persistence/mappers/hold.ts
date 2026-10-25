/**
 * Stock holds.
 *
 * A hold lives in the customer's partition (`CUSTOMER#<id>` / `HOLD#<holdId>`), beside their orders,
 * so one partition still answers everything about one customer.
 *
 * Two things this mapper decides, and nothing else does:
 *
 * - the `holds-index` keys are written only while the hold is HELD, which is what makes that index
 *   sparse. A confirmed or released hold is not in the sweeper's queue because its keys are gone,
 *   not because the sweeper filtered it out.
 * - `ttl` is a day after `expiresAt`, because TTL is cleanup and not the timer. DynamoDB deletes
 *   expired items within a few days, so correctness comes from the `expiresAt` conditions on the
 *   confirm and release writes, and TTL only stops the table growing (spec section 7).
 */

import { z } from 'zod';

import {
  customerId as parseCustomerId,
  holdId as parseHoldId,
  categoryId as parseCategoryId,
  productId as parseProductId,
  sku as parseSku,
} from '../../domain/ids.js';
import type { Hold, HoldStatus, HoldSweepEntry } from '../../domain/hold.js';
import { HOLD_STATUSES } from '../../domain/hold.js';
import { EUR, money } from '../../domain/money.js';
import type { Allocation, OrderLine } from '../../domain/order.js';
import { HOLD_TTL_HOURS, ttlInHours } from '../../shared/ttl.js';
import { EntityType, SCHEMA_VERSION } from '../entity-types.js';
import {
  HOLDS_INDEX_ATTRIBUTES,
  holdKey,
  holdsIndexAttributes,
  parseHoldsIndexSk,
} from '../keys.js';
import { buildDomain, parseItem } from './parse.js';

const statusSchema = z.enum(HOLD_STATUSES);

const allocationSchema = z.object({
  sku: z.string(),
  bucket: z.number().int().nonnegative(),
  qty: z.number().int().positive(),
});

/**
 * The price snapshot, stored on the hold itself.
 *
 * Confirming turns these into order lines without re-reading the catalog, so the price the shopper
 * was quoted is the price they pay even if the catalog moved during the ten minutes.
 */
const lineSchema = z.object({
  sku: z.string(),
  productId: z.string(),
  categoryId: z.string(),
  qty: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  currency: z.literal(EUR),
});

const holdItemSchema = z.object({
  entityType: z.literal(EntityType.Hold),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  holdId: z.string(),
  customerId: z.string(),
  status: statusSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
  allocations: z.array(allocationSchema),
  lines: z.array(lineSchema).min(1),
});

/** Reads the index's sort key without naming the attribute outside keys.ts. */
const holdsIndexSortKeyOf = (record: Record<string, unknown>): string => {
  const value = record[HOLDS_INDEX_ATTRIBUTES.sort];
  if (typeof value !== 'string') {
    throw new Error('Index item has no holds sort key');
  }
  return value;
};

export function holdToItem(hold: Hold): Record<string, unknown> {
  return {
    ...holdKey(hold.customerId, hold.holdId),
    ...(hold.status === 'HELD' ? holdsIndexAttributes(hold.holdId, hold.expiresAt) : {}),
    entityType: EntityType.Hold,
    schemaVersion: SCHEMA_VERSION,
    version: hold.version,
    holdId: hold.holdId,
    customerId: hold.customerId,
    status: hold.status,
    expiresAt: hold.expiresAt,
    createdAt: hold.createdAt,
    allocations: hold.allocations.map((allocation) => ({ ...allocation })),
    lines: hold.lines.map((line) => ({
      sku: line.sku,
      productId: line.productId,
      categoryId: line.categoryId,
      qty: line.qty,
      unitPriceCents: line.unitPrice.amountCents,
      currency: line.unitPrice.currency,
    })),
    ttl: ttlInHours(new Date(hold.expiresAt), HOLD_TTL_HOURS),
  };
}

export function holdFromItem(raw: unknown): Hold {
  const item = parseItem(holdItemSchema, EntityType.Hold, raw);

  return buildDomain(EntityType.Hold, raw, () => ({
    holdId: parseHoldId(item.holdId),
    customerId: parseCustomerId(item.customerId),
    status: item.status satisfies HoldStatus,
    expiresAt: item.expiresAt,
    createdAt: item.createdAt,
    allocations: item.allocations.map((allocation): Allocation => ({
      sku: parseSku(allocation.sku),
      bucket: allocation.bucket,
      qty: allocation.qty,
    })),
    lines: item.lines.map((line): OrderLine => ({
      sku: parseSku(line.sku),
      productId: parseProductId(line.productId),
      categoryId: parseCategoryId(line.categoryId),
      qty: line.qty,
      unitPrice: money(line.unitPriceCents, line.currency),
    })),
    version: item.version,
  }));
}

/** AP15: one sweeper row, built from the projection plus the keys the index always carries. */
const holdsIndexItemSchema = z.object({
  customerId: z.string(),
});

export function holdSweepEntryFromIndexItem(raw: unknown): HoldSweepEntry {
  const item = parseItem(holdsIndexItemSchema, EntityType.Hold, raw);
  const record = raw as Record<string, unknown>;

  return buildDomain(EntityType.Hold, raw, () => {
    const { expiresAt, holdId } = parseHoldsIndexSk(holdsIndexSortKeyOf(record));

    return {
      holdId: parseHoldId(holdId),
      customerId: parseCustomerId(item.customerId),
      expiresAt,
    };
  });
}
