/**
 * `GET /warehouse/queue?limit` (AP12).
 *
 * Ten parallel queries, one per index shard, merged oldest first. Shipped and cancelled orders are
 * absent because their index keys were removed, not because anything filtered them out.
 */

import { parseQueueQuery, toQueueResponse } from '../../api/schemas/warehouse.js';
import { warehouseRepository } from '../../persistence/repositories/warehouse.js';
import { httpRoute, ok } from '../../shared/http.js';
import { logger } from '../../shared/logger.js';

const warehouse = warehouseRepository();

export const handler = httpRoute('warehouse-queue', async (event) => {
  const query = parseQueueQuery(event.queryStringParameters);

  const queue = await warehouse.queue({
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  });

  logger.info('Warehouse queue read', { shards: queue.shards, returned: queue.items.length });

  return ok(toQueueResponse(queue));
});
