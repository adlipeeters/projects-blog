/**
 * `GET /skus/{sku}/stock` (AP13).
 *
 * `BatchGetItem` across every bucket of the sku, strongly consistent, summed. Strong because the
 * answer is a sum of counters other requests are decrementing right now, and "how many are left"
 * is the one number a sale cannot be vague about.
 */

import { toStockResponse } from '../../api/schemas/stock.js';
import { sku as parseSku } from '../../domain/ids.js';
import { stockRepository } from '../../persistence/repositories/stock.js';
import { httpRoute, ok } from '../../shared/http.js';
import { logger } from '../../shared/logger.js';

const stock = stockRepository();

export const handler = httpRoute('get-stock', async (event) => {
  const sku = parseSku(event.pathParameters?.['sku'] ?? '');

  const available = await stock.forSku(sku);
  logger.info('Stock read', { sku, buckets: available.buckets.length });

  return ok(toStockResponse(available));
});
