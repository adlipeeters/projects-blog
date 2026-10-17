/**
 * Order headers and order lines.
 *
 * The header lives in the customer's partition (`CUSTOMER#<id>` / `ORDER#<orderId>`) so AP8 lists a
 * customer's orders with one Query, and the lines live in their own partition
 * (`ORDER#<orderId>` / `LINE#<sku>`) so AP10 reads them without touching the header.
 *
 * Index attributes are written by this mapper and nowhere else:
 *
 * - `LSI1SK` always, because AP9 filters by status and the LSI is what makes that read strongly
 *   consistent.
 * - the fulfillment index keys only while the order still needs fulfilment, which is what makes
 *   that index sparse: a shipped order is not in the queue because its keys are gone.
 */

import { z } from 'zod';

import {
  categoryId as parseCategoryId,
  customerId as parseCustomerId,
  orderId as parseOrderId,
  productId as parseProductId,
  sku as parseSku,
} from '../../domain/ids.js';
import { EUR, money } from '../../domain/money.js';
import type {
  Allocation,
  FulfillmentEntry,
  Order,
  OrderLine,
  OrderStatus,
} from '../../domain/order.js';
import { ORDER_STATUSES, needsFulfillment } from '../../domain/order.js';
import { EntityType, SCHEMA_VERSION } from '../entity-types.js';
import {
  FULFILLMENT_INDEX_ATTRIBUTES,
  fulfillmentIndexAttributes,
  orderKey,
  orderLineKey,
  orderStatusLsiAttributes,
  parseFulfillmentIndexSk,
} from '../keys.js';
import { buildDomain, parseItem } from './parse.js';

const statusSchema = z.enum(ORDER_STATUSES);

/** Reads the index's sort key without naming the attribute outside keys.ts. */
const fulfillmentIndexSortKeyOf = (record: Record<string, unknown>): string => {
  const value = record[FULFILLMENT_INDEX_ATTRIBUTES.sort];
  if (typeof value !== 'string') {
    throw new Error('Index item has no fulfillment sort key');
  }
  return value;
};

const allocationSchema = z.object({
  sku: z.string(),
  bucket: z.number().int().nonnegative(),
  qty: z.number().int().positive(),
});

const orderItemSchema = z.object({
  entityType: z.literal(EntityType.Order),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  orderId: z.string(),
  customerId: z.string(),
  status: statusSchema,
  totalCents: z.number().int().nonnegative(),
  currency: z.literal(EUR),
  placedAt: z.string(),
  updatedAt: z.string(),
  allocations: z.array(allocationSchema),
});

const orderLineItemSchema = z.object({
  entityType: z.literal(EntityType.OrderLine),
  schemaVersion: z.number().int().positive(),
  sku: z.string(),
  productId: z.string(),
  categoryId: z.string(),
  customerId: z.string(),
  qty: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  currency: z.literal(EUR),
});

export function orderToItem(order: Order): Record<string, unknown> {
  return {
    ...orderKey(order.customerId, order.orderId),
    ...orderStatusLsiAttributes(order.status, order.orderId),
    ...(needsFulfillment(order.status)
      ? fulfillmentIndexAttributes(order.orderId, order.placedAt)
      : {}),
    entityType: EntityType.Order,
    schemaVersion: SCHEMA_VERSION,
    version: order.version,
    orderId: order.orderId,
    customerId: order.customerId,
    status: order.status,
    totalCents: order.total.amountCents,
    currency: order.total.currency,
    placedAt: order.placedAt,
    updatedAt: order.updatedAt,
    allocations: order.allocations.map((allocation) => ({ ...allocation })),
  };
}

export function orderFromItem(raw: unknown): Order {
  const item = parseItem(orderItemSchema, EntityType.Order, raw);

  return buildDomain(EntityType.Order, raw, () => ({
    orderId: parseOrderId(item.orderId),
    customerId: parseCustomerId(item.customerId),
    status: item.status satisfies OrderStatus,
    total: money(item.totalCents, item.currency),
    placedAt: item.placedAt,
    updatedAt: item.updatedAt,
    allocations: item.allocations.map((allocation): Allocation => ({
      sku: parseSku(allocation.sku),
      bucket: allocation.bucket,
      qty: allocation.qty,
    })),
    version: item.version,
  }));
}

/** Immutable: a line records what was bought at the price agreed at the time. */
export function orderLineToItem(
  orderId: string,
  customerId: string,
  line: OrderLine,
): Record<string, unknown> {
  return {
    ...orderLineKey(orderId, line.sku),
    entityType: EntityType.OrderLine,
    schemaVersion: SCHEMA_VERSION,
    sku: line.sku,
    productId: line.productId,
    categoryId: line.categoryId,
    customerId,
    qty: line.qty,
    unitPriceCents: line.unitPrice.amountCents,
    currency: line.unitPrice.currency,
  };
}

/**
 * AP12: one queue row, built from the index projection plus the keys the index always carries.
 */
const fulfillmentIndexItemSchema = z.object({
  customerId: z.string(),
  status: statusSchema,
  totalCents: z.number().int().nonnegative(),
});

export function fulfillmentEntryFromIndexItem(raw: unknown): FulfillmentEntry {
  const item = parseItem(fulfillmentIndexItemSchema, EntityType.Order, raw);
  const record = raw as Record<string, unknown>;

  return buildDomain(EntityType.Order, raw, () => {
    const sortKey = fulfillmentIndexSortKeyOf(record);
    const { placedAt, orderId } = parseFulfillmentIndexSk(sortKey);

    return {
      orderId: parseOrderId(orderId),
      customerId: parseCustomerId(item.customerId),
      status: item.status,
      total: money(item.totalCents, EUR),
      placedAt,
    };
  });
}

export function orderLineFromItem(raw: unknown): OrderLine {
  const item = parseItem(orderLineItemSchema, EntityType.OrderLine, raw);

  return buildDomain(EntityType.OrderLine, raw, () => ({
    sku: parseSku(item.sku),
    productId: parseProductId(item.productId),
    categoryId: parseCategoryId(item.categoryId),
    qty: item.qty,
    unitPrice: money(item.unitPriceCents, item.currency),
  }));
}
