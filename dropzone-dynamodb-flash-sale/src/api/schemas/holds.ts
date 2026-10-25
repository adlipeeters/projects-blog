/**
 * Request and response DTOs for the hold routes (AP15).
 *
 * The body is the same shape checkout takes, because a hold is a checkout whose payment has not
 * happened yet: the client sends the lines it saw and the server prices them from the catalog.
 */

import { z } from 'zod';

import type { Hold } from '../../domain/hold.js';
import { sku as parseSku } from '../../domain/ids.js';
import { orderTotal } from '../../domain/order.js';
import { ValidationError } from '../../shared/errors.js';
import { MAX_HOLD_LINES } from '../../persistence/repositories/holds.js';

const MAX_QTY_PER_LINE = 10;

const holdSchema = z.object({
  lines: z
    .array(
      z.object({
        sku: z.string().min(1),
        qty: z.number().int().min(1).max(MAX_QTY_PER_LINE),
      }),
    )
    .min(1)
    .max(MAX_HOLD_LINES),
});

export type HoldBody = {
  readonly lines: readonly { readonly sku: ReturnType<typeof parseSku>; readonly qty: number }[];
};

export function parseHoldBody(body: unknown): HoldBody {
  const result = holdSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Invalid request: ${issue === undefined ? 'unknown field' : `${issue.path.join('.')} ${issue.message.toLowerCase()}`}`,
    );
  }

  const seen = new Set<string>();
  for (const line of result.data.lines) {
    if (seen.has(line.sku)) {
      // The hold stores one snapshot line per sku, so two lines for one sku would collide.
      throw new ValidationError('Each sku may appear at most once per hold', { sku: line.sku });
    }
    seen.add(line.sku);
  }

  return { lines: result.data.lines.map((line) => ({ sku: parseSku(line.sku), qty: line.qty })) };
}

export type HoldDto = {
  readonly holdId: string;
  readonly status: string;
  /** The client needs this to show a countdown, and to know when confirming is pointless. */
  readonly expiresAt: string;
  readonly totalCents: number;
  readonly currency: string;
};

/**
 * `allocations` is deliberately absent, as it is on an order: which bucket the units came from is
 * internal, and exposing it would invite a client to depend on the sharding.
 */
export function toHoldResponse(hold: Hold): HoldDto {
  // The same arithmetic the order will use, so the quote and the charge cannot differ.
  const total = orderTotal(hold.lines);

  return {
    holdId: hold.holdId,
    status: hold.status,
    expiresAt: hold.expiresAt,
    totalCents: total.amountCents,
    currency: total.currency,
  };
}
