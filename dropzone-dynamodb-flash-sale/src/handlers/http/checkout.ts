/**
 * `POST /checkout` (AP7).
 *
 * 201 for a new order, 200 when an idempotent retry replays the original, 409 when a sku is sold
 * out, 422 when an idempotency key is reused for a different body.
 *
 * Deleting the cart afterwards is best-effort and arrives with the carts table in M5.
 */

import {
  parseCheckoutBody,
  parseIdempotencyKey,
  toOrderPlacedResponse,
} from '../../api/schemas/checkout.js';
import { customerId as parseCustomerId } from '../../domain/ids.js';
import { orderRepository } from '../../persistence/repositories/orders.js';
import { ValidationError } from '../../shared/errors.js';
import { httpRoute, jsonBody, ok, created } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const orders = orderRepository();

/** Auth is a trusted header behind API Gateway, which is a documented non-goal (spec section 1). */
const customerFrom = (headers: Record<string, string | undefined>) => {
  const raw = headers['x-customer-id'];
  if (raw === undefined || raw.length === 0) {
    throw new ValidationError('An x-customer-id header is required');
  }
  return parseCustomerId(raw);
};

export const handler = httpRoute('checkout', async (event) => {
  const customerId = customerFrom(event.headers);
  const idempotencyKey = parseIdempotencyKey(event.headers);
  const body = parseCheckoutBody(jsonBody(event));

  const result = await orders.checkout({ customerId, idempotencyKey, lines: body.lines });
  addLogContext({ orderId: result.order.orderId });

  const payload = toOrderPlacedResponse(result.order);
  return result.replayed ? ok(payload) : created(payload);
});
