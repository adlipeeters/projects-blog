/**
 * `DELETE /checkout/holds/{holdId}` (AP15).
 *
 * 200 with the released hold, 409 when it was already confirmed or released, 404 when there is no
 * such hold.
 *
 * The units go back to the buckets they came from in the same transaction that closes the hold, so
 * a released hold whose stock was never returned is not a state this code can produce.
 */

import { toHoldResponse } from '../../api/schemas/holds.js';
import { holdId as parseHoldId } from '../../domain/ids.js';
import { holdRepository } from '../../persistence/repositories/holds.js';
import { ConflictError } from '../../shared/errors.js';
import { httpRoute, ok, requireCustomerId } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const holds = holdRepository();

export const handler = httpRoute('release-hold', async (event) => {
  const customerId = requireCustomerId(event.headers);
  const holdId = parseHoldId(event.pathParameters?.['holdId'] ?? '');
  addLogContext({ holdId });

  const outcome = await holds.releaseHold(customerId, holdId);

  if (outcome.kind === 'already-resolved') {
    // Confirmed, or the sweeper got there first. Either way this request changed nothing, and the
    // client needs to read the hold again rather than retry.
    throw new ConflictError('That hold has already been resolved');
  }

  return ok(toHoldResponse(outcome.hold));
});
