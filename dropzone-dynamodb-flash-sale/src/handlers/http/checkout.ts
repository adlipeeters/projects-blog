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
import { orderRepository } from '../../persistence/repositories/orders.js';
import { httpRoute, jsonBody, ok, created, requireCustomerId } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const orders = orderRepository();

export const handler = httpRoute('checkout', async (event) => {
  const customerId = requireCustomerId(event.headers);
  const idempotencyKey = parseIdempotencyKey(event.headers);
  const body = parseCheckoutBody(jsonBody(event));

  const result = await orders.checkout({ customerId, idempotencyKey, lines: body.lines });
  addLogContext({ orderId: result.order.orderId });

  const payload = toOrderPlacedResponse(result.order);
  return result.replayed ? ok(payload) : created(payload);
});
