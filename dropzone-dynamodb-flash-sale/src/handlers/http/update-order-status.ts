/**
 * `PATCH /customers/{customerId}/orders/{orderId}` (AP11).
 *
 * The client sends the target status and the version it read. The version is the precondition: two
 * warehouse screens acting on the same order cannot both win, and the loser gets a 409 telling it
 * to read again.
 *
 * Cancelling is a different write from the others, because the units have to go back to the buckets
 * they came from, so it is a transaction rather than an update.
 */

import { parseStatusChange, toOrderResponse } from '../../api/schemas/orders.js';
import { customerId as parseCustomerId, orderId as parseOrderId } from '../../domain/ids.js';
import { orderRepository } from '../../persistence/repositories/orders.js';
import { NotFoundError } from '../../shared/errors.js';
import { httpRoute, jsonBody, ok } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const orders = orderRepository();

export const handler = httpRoute('update-order-status', async (event) => {
  const customerId = parseCustomerId(event.pathParameters?.['customerId'] ?? '');
  const orderId = parseOrderId(event.pathParameters?.['orderId'] ?? '');
  const change = parseStatusChange(jsonBody(event));
  addLogContext({ customerId, orderId });

  if (change.status === 'CANCELLED') {
    return ok(toOrderResponse(await orders.cancelOrder(customerId, orderId, change.version)));
  }

  // The current status is read rather than taken from the client: the condition on the write still
  // makes the change safe, and this way a missing order is a 404 instead of a 409.
  const current = await orders.getOrder(customerId, orderId);
  if (current === null) {
    throw new NotFoundError('No such order');
  }

  const updated = await orders.updateStatus(customerId, orderId, {
    from: current.status,
    to: change.status,
    expectedVersion: change.version,
  });

  return ok(toOrderResponse(updated));
});
