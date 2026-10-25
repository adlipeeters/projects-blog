/**
 * `POST /checkout/holds` (AP15).
 *
 * 201 with the hold and its expiry, 200 when an idempotent retry replays the original, 409 when
 * every bucket of a sku is empty.
 *
 * The units leave `available` here, not at confirm time, which is what makes the reservation real:
 * nobody else can buy them while this shopper's payment is in flight.
 */

import { parseHoldBody, toHoldResponse } from '../../api/schemas/holds.js';
import { parseIdempotencyKey } from '../../api/schemas/checkout.js';
import { holdRepository } from '../../persistence/repositories/holds.js';
import { httpRoute, jsonBody, ok, created, requireCustomerId } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const holds = holdRepository();

export const handler = httpRoute('create-hold', async (event) => {
  const customerId = requireCustomerId(event.headers);
  const idempotencyKey = parseIdempotencyKey(event.headers);
  const body = parseHoldBody(jsonBody(event));

  const result = await holds.createHold({ customerId, idempotencyKey, lines: body.lines });
  addLogContext({ holdId: result.hold.holdId });

  const payload = toHoldResponse(result.hold);
  return result.replayed ? ok(payload) : created(payload);
});
