/**
 * The hold repository: AP15.
 *
 * A flash sale takes the stock first and the payment second, so the units a shopper is about to buy
 * cannot be sold to someone else while their card is being charged. A hold is that reservation.
 *
 * Three writes, each one transaction:
 *
 * - **create**: the same conditional bucket decrements checkout does, plus the hold itself. The
 *   units are gone from `available` the moment the hold exists, which is what makes the reservation
 *   real rather than advisory.
 * - **confirm**: the hold moves to CONFIRMED and the order appears, in one transaction. No stock is
 *   touched, because it was taken at create time.
 * - **release**: the hold moves to RELEASED and every allocated unit goes back to the bucket it came
 *   from. Doing that as two writes would risk a released hold whose units were never returned.
 *
 * The timer is `expiresAt`, compared inside the conditions, not TTL. DynamoDB deletes expired items
 * within a few days, not on the second, so a confirm after expiry has to be refused by a condition
 * rather than by the item being gone. That is also what makes confirm and release mutually
 * exclusive: both require `status = HELD`, so exactly one of them can win (spec section 7).
 */

import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';

import type { Hold, HoldSweepEntry } from '../../domain/hold.js';
import { holdExpiry } from '../../domain/hold.js';
import type { CustomerId, HoldId, OrderId, Sku } from '../../domain/ids.js';
import { newHoldId, newOrderId, orderId as parseOrderId } from '../../domain/ids.js';
import type { Allocation, Order, OrderLine } from '../../domain/order.js';
import { orderTotal } from '../../domain/order.js';
import { commerceTable } from '../../shared/env.js';
import {
  ConflictError,
  HoldExpiredError,
  IdempotencyMismatchError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { MetricName, count } from '../../shared/metrics.js';
import { pageSize } from '../../shared/pagination.js';
import { requestHash } from '../../shared/request-hash.js';
import { IDEMPOTENCY_TTL_HOURS, ttlInHours } from '../../shared/ttl.js';
import {
  MAX_CONFLICT_ATTEMPTS,
  type RequestedLine,
  cancellationReasons,
  chooseBuckets,
  classifyCancellation,
  isTransactionCancelled,
  jitteredBackoffMs,
  priceLines,
  rememberEmptyBuckets,
  rotationBudget,
  sleep,
} from '../allocation.js';
import { documentClient } from '../client.js';
import {
  HOLDS_INDEX,
  HOLDS_INDEX_ATTRIBUTES,
  PARTITION_ATTRIBUTE,
  holdConfirmIdempotencyToken,
  holdKey,
  holdsIndexShards,
  idempotencyKey,
  orderKey,
  stockBucketKey,
} from '../keys.js';
import { holdFromItem, holdSweepEntryFromIndexItem, holdToItem } from '../mappers/hold.js';
import { idempotencyFromItem, idempotencyToItem } from '../mappers/idempotency.js';
import { orderFromItem, orderLineToItem, orderToItem } from '../mappers/order.js';
import { catalogRepository } from './catalog.js';

export type HoldRequest = {
  readonly customerId: CustomerId;
  readonly idempotencyKey: string;
  readonly lines: readonly RequestedLine[];
};

export type HoldResult = {
  readonly hold: Hold;
  /** True when this request was already handled and the original hold is being returned. */
  readonly replayed: boolean;
};

export type ConfirmResult = {
  readonly order: Order;
  /** True when this hold was already confirmed and its order is being returned. */
  readonly replayed: boolean;
};

/**
 * What releasing found.
 *
 * `already-resolved` is not an error for the sweeper: it means the customer confirmed or released
 * the hold in the second between the index query and the write, which is the common case under
 * load. The HTTP route turns it into a 409; the sweeper just moves on.
 */
export type ReleaseOutcome =
  { readonly kind: 'released'; readonly hold: Hold } | { readonly kind: 'already-resolved' };

export type ExpiredHolds = {
  readonly items: readonly HoldSweepEntry[];
  /** How many index shards answered, which is what makes the fan-out visible in a log line. */
  readonly shards: number;
};

/** Spec section 7: at most 20 lines, the same cap checkout uses. */
export const MAX_HOLD_LINES = 20;

/** Where each kind of item sits in the confirm transaction, read by position on a cancellation. */
const CONFIRM_IDEMPOTENCY_POSITION = 0;
const CONFIRM_HOLD_POSITION = 1;

/** The release transaction puts the hold first, then one credit per allocation. */
const RELEASE_HOLD_POSITION = 0;

const CONDITION_FAILED = 'ConditionalCheckFailed';

const draftHold = (input: {
  readonly holdId: HoldId;
  readonly customerId: CustomerId;
  readonly lines: readonly OrderLine[];
  readonly allocations: readonly Allocation[];
  readonly now: Date;
}): Hold => ({
  holdId: input.holdId,
  customerId: input.customerId,
  status: 'HELD',
  expiresAt: holdExpiry(input.now),
  allocations: input.allocations,
  lines: input.lines,
  createdAt: input.now.toISOString(),
  version: 1,
});

/** The order a confirmed hold becomes. Priced from the hold's snapshot, not from the catalog. */
const orderFromHold = (hold: Hold, orderId: OrderId, now: Date): Order => ({
  orderId,
  customerId: hold.customerId,
  status: 'PLACED',
  total: orderTotal(hold.lines),
  placedAt: now.toISOString(),
  updatedAt: now.toISOString(),
  allocations: hold.allocations,
  version: 1,
});

/**
 * The items that make up a create-hold, in the order the shared cancellation positions assume:
 * idempotency first, then one conditional decrement per bucket, then the hold.
 */
function createHoldItems(input: {
  readonly table: string;
  readonly request: HoldRequest;
  readonly hold: Hold;
  readonly hash: string;
  readonly now: Date;
}): NonNullable<TransactWriteCommandInput['TransactItems']> {
  const { table, request, hold, hash, now } = input;

  return [
    // 1. This request is new.
    {
      Put: {
        TableName: table,
        Item: idempotencyToItem({
          customerId: request.customerId,
          key: request.idempotencyKey,
          holdId: hold.holdId,
          requestHash: hash,
          ttl: ttlInHours(now, IDEMPOTENCY_TTL_HOURS),
        }),
        ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
      },
    },
    // 2. The units exist. The same condition checkout uses, against the same buckets.
    ...hold.allocations.map((allocation) => ({
      Update: {
        TableName: table,
        Key: stockBucketKey(allocation.sku, allocation.bucket),
        UpdateExpression: 'SET available = available - :qty, version = version + :one',
        ConditionExpression: 'available >= :qty',
        ExpressionAttributeValues: { ':qty': allocation.qty, ':one': 1 },
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD' as const,
      },
    })),
    // 3. The hold, carrying the price snapshot confirm will turn into order lines.
    {
      Put: {
        TableName: table,
        Item: holdToItem(hold),
        ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
      },
    },
  ];
}

export function holdRepository(catalog = catalogRepository()) {
  const commerce = (): string => commerceTable();

  return {
    /**
     * AP15, create. Returns the hold, or the original one when this request was already handled.
     *
     * Identical in shape to checkout, deliberately: it walks the same buckets with the same
     * rotation, retries the same conflicts with the same budget, and reads a cancellation the same
     * way. The difference is only what it writes at the end.
     */
    async createHold(request: HoldRequest, now = new Date()): Promise<HoldResult> {
      if (request.lines.length === 0) {
        throw new ValidationError('A hold needs at least one line');
      }
      if (request.lines.length > MAX_HOLD_LINES) {
        throw new ValidationError(`A hold may have at most ${String(MAX_HOLD_LINES)} lines`, {
          lines: request.lines.length,
        });
      }

      const priced = await priceLines(catalog, request.lines);
      const lines = priced.map((entry) => entry.line);

      const hash = requestHash({
        lines: request.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
      });

      // One id for the whole request: a cancelled transaction writes nothing, so reusing it across
      // attempts cannot leave a stray hold behind.
      const holdId = newHoldId();

      const exhausted = new Map<Sku, Set<number>>();
      let conflicts = 0;

      for (
        let attempt = 0;
        attempt < MAX_CONFLICT_ATTEMPTS + rotationBudget(priced);
        attempt += 1
      ) {
        const allocations = chooseBuckets(priced, exhausted);
        const hold = draftHold({ holdId, customerId: request.customerId, lines, allocations, now });

        try {
          await documentClient().send(
            new TransactWriteCommand({
              TransactItems: createHoldItems({ table: commerce(), request, hold, hash, now }),
            }),
          );

          return { hold, replayed: false };
        } catch (error: unknown) {
          if (!isTransactionCancelled(error)) {
            throw error;
          }

          const verdict = classifyCancellation(cancellationReasons(error), allocations);

          switch (verdict.kind) {
            case 'replay':
              return await this.replayHold(request, hash);

            case 'rotate':
              rememberEmptyBuckets(verdict.empty, priced, exhausted);
              logger.debug('Stock bucket empty, rotating', { attempt });
              continue;

            case 'conflict':
              conflicts += 1;
              count(MetricName.TxConflictRetries);
              if (conflicts >= MAX_CONFLICT_ATTEMPTS) {
                throw new ConflictError('Too much contention on this drop, please retry');
              }
              await sleep(jitteredBackoffMs(conflicts));
              continue;

            default:
              throw error;
          }
        }
      }

      throw new ConflictError('Too much contention on this drop, please retry');
    },

    /** Returns the hold an earlier request with this idempotency key created. */
    async replayHold(request: HoldRequest, hash: string): Promise<HoldResult> {
      const existing = await documentClient().send(
        new GetCommand({
          TableName: commerce(),
          Key: idempotencyKey(request.customerId, request.idempotencyKey),
          ConsistentRead: true,
        }),
      );

      if (existing.Item === undefined) {
        // It existed a moment ago and does not now: its TTL passed between the two calls.
        throw new ConflictError('That idempotency key is no longer available, please retry');
      }

      const record = idempotencyFromItem(existing.Item);
      if (record.requestHash !== hash) {
        throw new IdempotencyMismatchError(
          'That idempotency key was used for a different request body',
        );
      }
      if (record.kind !== 'hold') {
        throw new IdempotencyMismatchError('That idempotency key was used for a checkout');
      }

      const hold = await this.getHold(request.customerId, record.entityId as HoldId);
      if (hold === null) {
        throw new ConflictError('The original hold could not be read, please retry');
      }

      count(MetricName.IdempotentReplays);
      return { hold, replayed: true };
    },

    async getHold(customerId: CustomerId, holdId: HoldId): Promise<Hold | null> {
      const result = await documentClient().send(
        new GetCommand({
          TableName: commerce(),
          Key: holdKey(customerId, holdId),
          ConsistentRead: true,
        }),
      );

      return result.Item === undefined ? null : holdFromItem(result.Item);
    },

    /**
     * AP15, confirm: the hold becomes CONFIRMED and the order appears, in one transaction.
     *
     * No stock is touched. The units left `available` when the hold was created, so confirming is
     * purely a bookkeeping move, and the `expiresAt > :now` condition is what stops a late confirm
     * from reviving units the sweeper has already given back.
     *
     * Idempotent on the hold id rather than on a client header: a retried confirm has nothing new
     * to say, and the second call returns the order the first one created.
     */
    async confirmHold(
      customerId: CustomerId,
      holdId: HoldId,
      now = new Date(),
    ): Promise<ConfirmResult> {
      const hold = await this.getHold(customerId, holdId);
      if (hold === null) {
        throw new NotFoundError('No such hold');
      }

      const orderId = newOrderId();
      const order = orderFromHold(hold, orderId, now);
      const hash = requestHash({ holdId });

      try {
        await documentClient().send(
          new TransactWriteCommand({
            TransactItems: [
              // 1. This confirm is the first one for this hold.
              {
                Put: {
                  TableName: commerce(),
                  Item: idempotencyToItem({
                    customerId,
                    key: holdConfirmIdempotencyToken(holdId),
                    orderId,
                    requestHash: hash,
                    ttl: ttlInHours(now, IDEMPOTENCY_TTL_HOURS),
                  }),
                  ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
                },
              },
              // 2. The hold is still open and has not expired. This is the whole guarantee that
              //    confirm and release cannot both succeed.
              {
                Update: {
                  TableName: commerce(),
                  Key: holdKey(customerId, holdId),
                  UpdateExpression:
                    'SET #status = :confirmed, version = version + :one REMOVE #gsi3pk, #gsi3sk',
                  ConditionExpression: '#status = :held AND expiresAt > :now',
                  ExpressionAttributeNames: {
                    '#status': 'status',
                    '#gsi3pk': HOLDS_INDEX_ATTRIBUTES.partition,
                    '#gsi3sk': HOLDS_INDEX_ATTRIBUTES.sort,
                  },
                  ExpressionAttributeValues: {
                    ':confirmed': 'CONFIRMED',
                    ':held': 'HELD',
                    ':now': now.toISOString(),
                    ':one': 1,
                  },
                },
              },
              // 3. The order, with its fulfillment index keys, exactly as checkout writes it.
              {
                Put: {
                  TableName: commerce(),
                  Item: orderToItem(order),
                  ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
                },
              },
              // 4. Its lines, from the hold's price snapshot.
              ...hold.lines.map((line) => ({
                Put: {
                  TableName: commerce(),
                  Item: orderLineToItem(orderId, customerId, line),
                },
              })),
            ],
          }),
        );
      } catch (error: unknown) {
        if (!isTransactionCancelled(error)) {
          throw error;
        }

        const reasons = cancellationReasons(error);

        if (reasons[CONFIRM_IDEMPOTENCY_POSITION]?.Code === CONDITION_FAILED) {
          return await this.replayConfirm(customerId, holdId, hash);
        }

        if (reasons[CONFIRM_HOLD_POSITION]?.Code === CONDITION_FAILED) {
          // The condition covers two different failures, so the hold is read again to say which.
          // One extra read on the failure path beats unmarshalling the raw item DynamoDB attaches
          // to a cancellation reason.
          throw await this.explainClosedHold(customerId, holdId);
        }

        count(MetricName.TxConflictRetries);
        throw new ConflictError('That hold is being changed right now, please retry');
      }

      count(MetricName.OrdersPlaced);
      return { order, replayed: false };
    },

    /** Returns the order the first confirm of this hold created. */
    async replayConfirm(
      customerId: CustomerId,
      holdId: HoldId,
      hash: string,
    ): Promise<ConfirmResult> {
      const existing = await documentClient().send(
        new GetCommand({
          TableName: commerce(),
          Key: idempotencyKey(customerId, holdConfirmIdempotencyToken(holdId)),
          ConsistentRead: true,
        }),
      );

      if (existing.Item === undefined) {
        throw new ConflictError('That hold was already resolved, please read it again');
      }

      const record = idempotencyFromItem(existing.Item);
      if (record.requestHash !== hash || record.kind !== 'order') {
        throw new ConflictError('That hold was already resolved, please read it again');
      }

      const order = await documentClient().send(
        new GetCommand({
          TableName: commerce(),
          Key: orderKey(customerId, parseOrderId(record.entityId)),
          ConsistentRead: true,
        }),
      );

      if (order.Item === undefined) {
        throw new ConflictError('The original order could not be read, please retry');
      }

      count(MetricName.IdempotentReplays);
      return { order: orderFromItem(order.Item), replayed: true };
    },

    /**
     * Why a `status = HELD AND expiresAt > :now` condition failed: expired, or already resolved.
     *
     * A 410 and a 409 mean different things to a client. Expired means the units are back on sale
     * and the shopper has to start again; already resolved means someone else got there first with
     * this very hold.
     */
    async explainClosedHold(
      customerId: CustomerId,
      holdId: HoldId,
    ): Promise<ConflictError | HoldExpiredError | NotFoundError> {
      const hold = await this.getHold(customerId, holdId);

      if (hold === null) {
        return new NotFoundError('No such hold');
      }
      if (hold.status !== 'HELD') {
        return new ConflictError('That hold has already been resolved', { status: hold.status });
      }
      return new HoldExpiredError(holdId);
    },

    /**
     * AP15, release: the hold closes and every unit goes back to the bucket it came from.
     *
     * The allocations are read off the hold because nothing can recompute them: the writer picked
     * those buckets at random. `expiredOnly` is the sweeper's extra condition, so a background job
     * can never release a hold the customer is still allowed to confirm.
     */
    async releaseHold(
      customerId: CustomerId,
      holdId: HoldId,
      options: { readonly expiredOnly?: boolean } = {},
      now = new Date(),
    ): Promise<ReleaseOutcome> {
      const hold = await this.getHold(customerId, holdId);
      if (hold === null) {
        throw new NotFoundError('No such hold');
      }
      if (hold.status !== 'HELD') {
        return { kind: 'already-resolved' };
      }

      const expiredOnly = options.expiredOnly === true;

      try {
        await documentClient().send(
          new TransactWriteCommand({
            TransactItems: [
              // 1. The hold closes, and leaves the sweeper's index with it.
              {
                Update: {
                  TableName: commerce(),
                  Key: holdKey(customerId, holdId),
                  UpdateExpression:
                    'SET #status = :released, version = version + :one REMOVE #gsi3pk, #gsi3sk',
                  ConditionExpression: expiredOnly
                    ? '#status = :held AND expiresAt <= :now'
                    : '#status = :held',
                  ExpressionAttributeNames: {
                    '#status': 'status',
                    '#gsi3pk': HOLDS_INDEX_ATTRIBUTES.partition,
                    '#gsi3sk': HOLDS_INDEX_ATTRIBUTES.sort,
                  },
                  ExpressionAttributeValues: {
                    ':released': 'RELEASED',
                    ':held': 'HELD',
                    ':one': 1,
                    ...(expiredOnly ? { ':now': now.toISOString() } : {}),
                  },
                },
              },
              // 2. The units, back where they came from.
              ...hold.allocations.map((allocation) => ({
                Update: {
                  TableName: commerce(),
                  Key: stockBucketKey(allocation.sku, allocation.bucket),
                  UpdateExpression: 'SET available = available + :qty, version = version + :one',
                  ExpressionAttributeValues: { ':qty': allocation.qty, ':one': 1 },
                },
              })),
            ],
          }),
        );
      } catch (error: unknown) {
        if (!isTransactionCancelled(error)) {
          throw error;
        }

        const reasons = cancellationReasons(error);
        if (reasons[RELEASE_HOLD_POSITION]?.Code === CONDITION_FAILED) {
          // Confirmed, released, or not expired yet. All of them mean this release is not the one
          // that should have won, and none of them is an error worth retrying.
          return { kind: 'already-resolved' };
        }

        count(MetricName.TxConflictRetries);
        throw new ConflictError('That hold is being changed right now, please retry');
      }

      return {
        kind: 'released',
        hold: { ...hold, status: 'RELEASED', version: hold.version + 1 },
      };
    },

    /** The shard keys the sweeper fans out to. */
    shardsQueried(): readonly string[] {
      return holdsIndexShards();
    },

    /**
     * Every hold still open, whatever its expiry.
     *
     * The index is sparse, so this is a query for the whole index rather than a scan with a filter:
     * a confirmed or released hold is not in it at all. Used before seeding a load run, because
     * seeding overwrites `available` while an open hold's units are still counted against the old
     * total, and the sweeper crediting them back afterwards invents stock that was never seeded.
     */
    async openHolds(limit?: number): Promise<ExpiredHolds> {
      const perShard = pageSize(limit);
      const shards = holdsIndexShards();

      const pages = await Promise.all(
        shards.map(async (shard) => {
          const result = await documentClient().send(
            new QueryCommand({
              TableName: commerce(),
              IndexName: HOLDS_INDEX.name,
              KeyConditionExpression: '#pk = :pk',
              ExpressionAttributeNames: { '#pk': HOLDS_INDEX.partitionAttribute },
              ExpressionAttributeValues: { ':pk': shard },
              ScanIndexForward: true,
              Limit: perShard,
            }),
          );

          return (result.Items ?? []).map(holdSweepEntryFromIndexItem);
        }),
      );

      return { items: pages.flat(), shards: shards.length };
    },

    /**
     * AP15, the sweeper's read: `Query GSI3PK = HOLDS#<0-3> AND GSI3SK < <now>` on every shard.
     *
     * The index is sparse and sharded for the same reasons the warehouse queue is: a confirmed hold
     * is absent rather than filtered, and four shards keep a drop's hold writes off one index
     * partition. The sort key starts with `expiresAt`, so "expired" is a key condition rather than
     * a filter, and the query reads only rows it is going to release.
     */
    async expiredHolds(now = new Date(), limit?: number): Promise<ExpiredHolds> {
      const perShard = pageSize(limit);
      const shards = holdsIndexShards();

      const pages = await Promise.all(
        shards.map(async (shard) => {
          const result = await documentClient().send(
            new QueryCommand({
              TableName: commerce(),
              IndexName: HOLDS_INDEX.name,
              KeyConditionExpression: '#pk = :pk AND #sk < :now',
              ExpressionAttributeNames: {
                '#pk': HOLDS_INDEX.partitionAttribute,
                '#sk': HOLDS_INDEX.sortAttribute,
              },
              ExpressionAttributeValues: { ':pk': shard, ':now': now.toISOString() },
              // Longest expired first, so a backlog is worked off oldest to newest.
              ScanIndexForward: true,
              Limit: perShard,
            }),
          );

          return (result.Items ?? []).map(holdSweepEntryFromIndexItem);
        }),
      );

      const merged = pages
        .flat()
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt));

      return { items: merged, shards: shards.length };
    },
  };
}
