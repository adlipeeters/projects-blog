/**
 * Request and response DTOs for checkout (AP7).
 *
 * The client sends the lines it saw and the server re-prices them from the catalog, so a stale cart
 * cannot set the price. Quantities and the line count are capped here, where a 400 is cheap, rather
 * than inside the transaction, where it would cost a write.
 */

import { z } from 'zod';

import { sku as parseSku } from '../../domain/ids.js';
import type { Order } from '../../domain/order.js';
import { ValidationError } from '../../shared/errors.js';
import { MAX_CHECKOUT_LINES } from '../../persistence/repositories/orders.js';

const MAX_QTY_PER_LINE = 10;

const checkoutSchema = z.object({
  cartId: z.string().min(1).optional(),
  lines: z
    .array(
      z.object({
        sku: z.string().min(1),
        qty: z.number().int().min(1).max(MAX_QTY_PER_LINE),
      }),
    )
    .min(1)
    .max(MAX_CHECKOUT_LINES),
});

export type CheckoutBody = {
  readonly cartId?: string;
  readonly lines: readonly { readonly sku: ReturnType<typeof parseSku>; readonly qty: number }[];
};

export function parseCheckoutBody(body: unknown): CheckoutBody {
  const result = checkoutSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Invalid request: ${issue === undefined ? 'unknown field' : `${issue.path.join('.')} ${issue.message.toLowerCase()}`}`,
    );
  }

  const seen = new Set<string>();
  for (const line of result.data.lines) {
    if (seen.has(line.sku)) {
      // An order line is keyed by sku, so two lines for one sku would overwrite each other.
      throw new ValidationError('Each sku may appear at most once per order', { sku: line.sku });
    }
    seen.add(line.sku);
  }

  return {
    ...(result.data.cartId === undefined ? {} : { cartId: result.data.cartId }),
    lines: result.data.lines.map((line) => ({ sku: parseSku(line.sku), qty: line.qty })),
  };
}

/** The Idempotency-Key header is required: without it, a retry would place a second order. */
export function parseIdempotencyKey(headers: Record<string, string | undefined>): string {
  const key = headers['idempotency-key'];
  if (key === undefined || key.trim().length === 0) {
    throw new ValidationError('An Idempotency-Key header is required');
  }
  if (key.length > 200) {
    throw new ValidationError('Idempotency-Key is too long');
  }
  return key.trim();
}

export type OrderPlacedDto = {
  readonly orderId: string;
  readonly status: string;
  readonly totalCents: number;
  readonly currency: string;
};

export const toOrderPlacedResponse = (order: Order): OrderPlacedDto => ({
  orderId: order.orderId,
  status: order.status,
  totalCents: order.total.amountCents,
  currency: order.total.currency,
});
