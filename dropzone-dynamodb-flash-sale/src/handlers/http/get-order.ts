/**
 * `GET /customers/{customerId}/orders/{orderId}` (AP8, AP10).
 *
 * Two reads of two different partitions: the header from the customer's partition, the lines from
 * the order's own. They are independent, so they run in parallel.
 */

import { toOrderResponse } from '../../api/schemas/orders.js';
import { customerId as parseCustomerId, orderId as parseOrderId } from '../../domain/ids.js';
import { orderRepository } from '../../persistence/repositories/orders.js';
import { NotFoundError } from '../../shared/errors.js';
import { httpRoute, ok } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const orders = orderRepository();

export const handler = httpRoute('get-order', async (event) => {
  const customerId = parseCustomerId(event.pathParameters?.['customerId'] ?? '');
  const orderId = parseOrderId(event.pathParameters?.['orderId'] ?? '');
  addLogContext({ customerId, orderId });

  const [order, lines] = await Promise.all([
    orders.getOrder(customerId, orderId),
    orders.getOrderLines(orderId),
  ]);

  if (order === null) {
    throw new NotFoundError('No such order');
  }

  return ok(toOrderResponse(order, lines));
});
