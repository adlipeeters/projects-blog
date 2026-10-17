/**
 * `GET /customers/{customerId}/orders?status&cursor&limit` (AP8, AP9).
 *
 * With a status it reads the LSI, strongly consistent, so an order the customer just cancelled is
 * gone from the open-orders view on the very next request.
 */

import { parseListOrdersQuery, toOrderListResponse } from '../../api/schemas/orders.js';
import { customerId as parseCustomerId } from '../../domain/ids.js';
import { orderRepository } from '../../persistence/repositories/orders.js';
import { httpRoute, ok } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const orders = orderRepository();

export const handler = httpRoute('list-orders', async (event) => {
  const customerId = parseCustomerId(event.pathParameters?.['customerId'] ?? '');
  const query = parseListOrdersQuery(event.queryStringParameters);
  addLogContext({ customerId });

  const page = await orders.listOrders({
    customerId,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  });

  return ok(toOrderListResponse(page));
});
