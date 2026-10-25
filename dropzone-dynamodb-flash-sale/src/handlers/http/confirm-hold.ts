/**
 * `POST /checkout/holds/{holdId}/confirm` (AP15).
 *
 * 201 with the order, 200 when this hold was already confirmed, 410 when it expired first, 409 when
 * it was released.
 *
 * No Idempotency-Key header: the hold id is the key. A retried confirm has nothing new to say, so
 * the second call returns the order the first one created.
 */

import { toOrderPlacedResponse } from '../../api/schemas/checkout.js';
import { holdId as parseHoldId } from '../../domain/ids.js';
import { holdRepository } from '../../persistence/repositories/holds.js';
import { httpRoute, ok, created, requireCustomerId } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const holds = holdRepository();

export const handler = httpRoute('confirm-hold', async (event) => {
  const customerId = requireCustomerId(event.headers);
  const holdId = parseHoldId(event.pathParameters?.['holdId'] ?? '');
  addLogContext({ holdId });

  const result = await holds.confirmHold(customerId, holdId);
  addLogContext({ orderId: result.order.orderId });

  const payload = toOrderPlacedResponse(result.order);
  return result.replayed ? ok(payload) : created(payload);
});
