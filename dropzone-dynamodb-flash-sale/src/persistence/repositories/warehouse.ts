/**
 * The warehouse queue: AP12.
 *
 * `Query GSI1PK = FULFILL#<0-9>` on every shard in parallel, merged by sort key, oldest first.
 *
 * The index is sparse and sharded, and both choices are visible here. Sparse means a shipped order
 * is absent rather than filtered, so the read costs nothing for orders nobody has to pick. Sharded
 * means ten queries instead of one, which is the price of spreading the writes: every order placed
 * during a drop writes this index, and a throttled GSI throttles writes to the base table.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { FulfillmentEntry } from '../../domain/order.js';
import { commerceTable } from '../../shared/env.js';
import { pageSize } from '../../shared/pagination.js';
import { documentClient } from '../client.js';
import { FULFILLMENT_INDEX, fulfillmentIndexShards } from '../keys.js';
import { fulfillmentEntryFromIndexItem } from '../mappers/order.js';

export type QueueQuery = {
  readonly limit?: number;
};

export type Queue = {
  readonly items: readonly FulfillmentEntry[];
  /** How many shards answered, which is what makes the fan-out visible in a log line. */
  readonly shards: number;
};

export function warehouseRepository() {
  const table = (): string => commerceTable();

  return {
    /** The shard keys this repository fans out to. */
    shardsQueried(): readonly string[] {
      return fulfillmentIndexShards();
    },

    /**
     * No cursor, by design (spec section 7 lists `?limit` only).
     *
     * A cursor across ten shards would have to carry ten LastEvaluatedKeys, and a picker wants the
     * oldest few, not page seven. The cost is reading up to `limit` rows per shard to return
     * `limit` overall.
     */
    async queue(query: QueueQuery = {}): Promise<Queue> {
      const limit = pageSize(query.limit);
      const shards = fulfillmentIndexShards();

      const pages = await Promise.all(
        shards.map(async (shard) => {
          const result = await documentClient().send(
            new QueryCommand({
              TableName: table(),
              IndexName: FULFILLMENT_INDEX.name,
              KeyConditionExpression: '#pk = :pk',
              ExpressionAttributeNames: { '#pk': FULFILLMENT_INDEX.partitionAttribute },
              ExpressionAttributeValues: { ':pk': shard },
              // Oldest first inside the shard, so the merge only has to look at the heads.
              ScanIndexForward: true,
              Limit: limit,
            }),
          );

          return (result.Items ?? []).map(fulfillmentEntryFromIndexItem);
        }),
      );

      // placedAt is an ISO-8601 string, so a lexicographic sort is a chronological one. The order
      // id breaks ties, which keeps the merge stable for orders placed in the same millisecond.
      const merged = pages
        .flat()
        .sort((left, right) =>
          left.placedAt === right.placedAt
            ? left.orderId.localeCompare(right.orderId)
            : left.placedAt.localeCompare(right.placedAt),
        );

      return { items: merged.slice(0, limit), shards: shards.length };
    },
  };
}
