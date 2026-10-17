/**
 * Request and response DTOs for the order routes (AP8 to AP11).
 */

import { z } from 'zod';

import type { Order, OrderLine, OrderStatus } from '../../domain/order.js';
import { ORDER_STATUSES } from '../../domain/order.js';
import { ValidationError } from '../../shared/errors.js';
import { MAX_PAGE_SIZE, type Page } from '../../shared/pagination.js';

const listOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
});

export type ListOrdersQueryDto = z.infer<typeof listOrdersQuerySchema>;

const statusChangeSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  /** The version the client read. Sending it is what makes the update safe to retry. */
  version: z.number().int().nonnegative(),
});

export type StatusChangeDto = z.infer<typeof statusChangeSchema>;

const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Invalid request: ${issue === undefined ? 'unknown field' : `${issue.path.join('.')} ${issue.message.toLowerCase()}`}`,
    );
  }
  return result.data;
};

export const parseListOrdersQuery = (
  raw: Record<string, string | undefined> | undefined,
): ListOrdersQueryDto => parse(listOrdersQuerySchema, raw ?? {});

export const parseStatusChange = (body: unknown): StatusChangeDto =>
  parse(statusChangeSchema, body);

export type OrderLineDto = {
  readonly sku: string;
  readonly productId: string;
  readonly qty: number;
  readonly unitPriceCents: number;
};

export type OrderDto = {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly totalCents: number;
  readonly currency: string;
  readonly placedAt: string;
  readonly updatedAt: string;
  /** Needed for the next status change, so the client can send it back as a precondition. */
  readonly version: number;
  readonly lines?: readonly OrderLineDto[];
};

/**
 * `allocations` is deliberately absent: which stock bucket the units came from is an internal
 * detail, and exposing it would invite a client to depend on the sharding.
 */
export function toOrderResponse(order: Order, lines?: readonly OrderLine[]): OrderDto {
  return {
    orderId: order.orderId,
    status: order.status,
    totalCents: order.total.amountCents,
    currency: order.total.currency,
    placedAt: order.placedAt,
    updatedAt: order.updatedAt,
    version: order.version,
    ...(lines === undefined
      ? {}
      : {
          lines: lines.map((line) => ({
            sku: line.sku,
            productId: line.productId,
            qty: line.qty,
            unitPriceCents: line.unitPrice.amountCents,
          })),
        }),
  };
}

export type OrderListDto = {
  readonly items: readonly OrderDto[];
  readonly nextCursor: string | null;
};

export const toOrderListResponse = (page: Page<Order>): OrderListDto => ({
  items: page.items.map((order) => toOrderResponse(order)),
  nextCursor: page.cursor,
});
