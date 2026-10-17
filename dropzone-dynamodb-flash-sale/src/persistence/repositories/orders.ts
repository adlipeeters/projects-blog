/**
 * The order repository: AP7 to AP11.
 *
 * The checkout transaction is four kinds of item written atomically (spec section 7):
 * the idempotency item, one conditional decrement per stock bucket, the order header, and the
 * lines. All of it lands or none of it does, so no oversell, no double order and no lost stock are
 * properties of the database rather than of careful code.
 *
 * A cancelled transaction writes nothing, so a failed attempt leaves no idempotency key and no
 * half-order behind.
 */

import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { CustomerId, OrderId, Sku } from '../../domain/ids.js';
import { newOrderId, orderId as parseOrderId } from '../../domain/ids.js';
import type { Allocation, Order, OrderLine, OrderStatus } from '../../domain/order.js';
import { canTransition, holdsStock, needsFulfillment, orderTotal } from '../../domain/order.js';
import { bucketOrder } from '../../domain/stock.js';
import { commerceTable } from '../../shared/env.js';
import {
  ConflictError,
  IdempotencyMismatchError,
  InvalidTransitionError,
  NotFoundError,
  SoldOutError,
  ValidationError,
} from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { MetricName, count } from '../../shared/metrics.js';
import { decodeCursor, encodeCursor, pageSize, type Page } from '../../shared/pagination.js';
import { requestHash } from '../../shared/request-hash.js';
import { IDEMPOTENCY_TTL_HOURS, ttlInHours } from '../../shared/ttl.js';
import { documentClient } from '../client.js';
import {
  FULFILLMENT_INDEX_ATTRIBUTES,
  PARTITION_ATTRIBUTE,
  SORT_ATTRIBUTE,
  STATUS_LSI_ATTRIBUTE,
  STATUS_LSI_INDEX,
  customerPartition,
  idempotencyKey,
  orderKey,
  orderLinePartition,
  orderSkPrefix,
  orderStatusLsiPrefix,
  orderStatusLsiSk,
  stockBucketKey,
} from '../keys.js';
import { idempotencyFromItem, idempotencyToItem } from '../mappers/idempotency.js';
import {
  orderFromItem,
  orderLineFromItem,
  orderLineToItem,
  orderToItem,
} from '../mappers/order.js';
import { catalogRepository } from './catalog.js';

export type CheckoutLine = {
  readonly sku: Sku;
  readonly qty: number;
};

export type CheckoutRequest = {
  readonly customerId: CustomerId;
  readonly idempotencyKey: string;
  readonly lines: readonly CheckoutLine[];
};

export type CheckoutResult = {
  readonly order: Order;
  /** True when this request was already handled and the original order is being returned. */
  readonly replayed: boolean;
};

export type ListOrdersQuery = {
  readonly customerId: CustomerId;
  /** With a status, the query runs on the LSI (AP9); without it, on the table (AP8). */
  readonly status?: OrderStatus;
  readonly limit?: number;
  readonly cursor?: string;
};

export type StatusChange = {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  /** The version the caller read. The update fails if anything moved since. */
  readonly expectedVersion: number;
};

/** Spec section 7: at most 20 lines, which keeps the transaction well under its 100-action limit. */
export const MAX_CHECKOUT_LINES = 20;

/** Spec section 7: three attempts in total for transaction conflicts. */
const MAX_CONFLICT_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const jitteredBackoffMs = (attempt: number): number => 2 ** attempt * 25 * (0.5 + Math.random());

type CancellationReason = { readonly Code?: string };

const isTransactionCancelled = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TransactionCanceledException';

/**
 * Cancellation reasons come back as one entry per transaction item, in the order the items were
 * sent. Reading them by position is the only way to know which condition failed, which is why the
 * positions are computed explicitly rather than assumed.
 */
const cancellationReasons = (error: unknown): readonly CancellationReason[] =>
  (error as { CancellationReasons?: CancellationReason[] }).CancellationReasons ?? [];

const CONDITION_FAILED = 'ConditionalCheckFailed';
const TRANSACTION_CONFLICT = 'TransactionConflict';

/** Where each kind of item sits in the transaction, so a cancellation reason can be read by index. */
const IDEMPOTENCY_POSITION = 0;
const FIRST_STOCK_POSITION = 1;

type PricedLine = {
  readonly line: OrderLine;
  readonly buckets: number;
};

/**
 * What a cancelled transaction means for this request.
 *
 * DynamoDB reports one reason per transaction item, in the order the items were sent, and says
 * nothing about which business rule that was. Turning positions into a verdict is the whole trick,
 * and keeping it in one function makes it testable and readable.
 */
type Verdict =
  | { readonly kind: 'replay' }
  | { readonly kind: 'rotate'; readonly empty: readonly Allocation[] }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'unexpected' };

export function classifyCancellation(
  reasons: readonly CancellationReason[],
  allocations: readonly Allocation[],
): Verdict {
  if (reasons[IDEMPOTENCY_POSITION]?.Code === CONDITION_FAILED) {
    return { kind: 'replay' };
  }

  const empty = allocations.filter(
    (_, index) => reasons[index + FIRST_STOCK_POSITION]?.Code === CONDITION_FAILED,
  );
  if (empty.length > 0) {
    return { kind: 'rotate', empty };
  }

  if (reasons.some((reason) => reason.Code === TRANSACTION_CONFLICT)) {
    return { kind: 'conflict' };
  }

  return { kind: 'unexpected' };
}

/** One bucket per line: the first in this request's rotation that has not already refused it. */
function chooseBuckets(
  priced: readonly PricedLine[],
  exhausted: ReadonlyMap<Sku, ReadonlySet<number>>,
): Allocation[] {
  return priced.map((entry) => {
    const skipped = exhausted.get(entry.line.sku) ?? new Set<number>();
    const bucket = bucketOrder(entry.buckets).find((candidate) => !skipped.has(candidate));

    if (bucket === undefined) {
      count(MetricName.CheckoutSoldOut);
      throw new SoldOutError(entry.line.sku);
    }

    return { sku: entry.line.sku, bucket, qty: entry.line.qty };
  });
}

/** Records the buckets that refused this request, and gives up on a sku once none are left. */
function rememberEmptyBuckets(
  empty: readonly Allocation[],
  priced: readonly PricedLine[],
  exhausted: Map<Sku, Set<number>>,
): void {
  for (const allocation of empty) {
    const skipped = exhausted.get(allocation.sku) ?? new Set<number>();
    skipped.add(allocation.bucket);
    exhausted.set(allocation.sku, skipped);

    const buckets = priced.find((entry) => entry.line.sku === allocation.sku)?.buckets ?? 1;
    if (skipped.size >= buckets) {
      count(MetricName.CheckoutSoldOut);
      throw new SoldOutError(allocation.sku);
    }
  }
}

const draftOrder = (input: {
  readonly orderId: OrderId;
  readonly customerId: CustomerId;
  readonly lines: readonly OrderLine[];
  readonly allocations: readonly Allocation[];
  readonly now: Date;
}): Order => ({
  orderId: input.orderId,
  customerId: input.customerId,
  status: 'PLACED',
  total: orderTotal(input.lines),
  placedAt: input.now.toISOString(),
  updatedAt: input.now.toISOString(),
  allocations: input.allocations,
  version: 1,
});

/**
 * The four kinds of item that make up a checkout, in the order the cancellation positions above
 * assume.
 */
function checkoutItems(input: {
  readonly table: string;
  readonly request: CheckoutRequest;
  readonly order: Order;
  readonly lines: readonly OrderLine[];
  readonly hash: string;
  readonly now: Date;
}): NonNullable<TransactWriteCommandInput['TransactItems']> {
  const { table, request, order, lines, hash, now } = input;

  return [
    // 1. This request is new.
    {
      Put: {
        TableName: table,
        Item: idempotencyToItem({
          customerId: request.customerId,
          key: request.idempotencyKey,
          orderId: order.orderId,
          requestHash: hash,
          ttl: ttlInHours(now, IDEMPOTENCY_TTL_HOURS),
        }),
        ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
      },
    },
    // 2. The units exist. This condition is the entire no-oversell guarantee.
    ...order.allocations.map((allocation) => ({
      Update: {
        TableName: table,
        Key: stockBucketKey(allocation.sku, allocation.bucket),
        UpdateExpression: 'SET available = available - :qty, version = version + :one',
        ConditionExpression: 'available >= :qty',
        ExpressionAttributeValues: { ':qty': allocation.qty, ':one': 1 },
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD' as const,
      },
    })),
    // 3. The order itself.
    {
      Put: {
        TableName: table,
        Item: orderToItem(order),
        ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
      },
    },
    // 4. Its lines, immutable from here on.
    ...lines.map((line) => ({
      Put: {
        TableName: table,
        Item: orderLineToItem(order.orderId, request.customerId, line),
      },
    })),
  ];
}

export function orderRepository(catalog = catalogRepository()) {
  const commerce = (): string => commerceTable();

  /** Prices and bucket counts come from the catalog, never from the client (spec section 7). */
  async function priceLines(lines: readonly CheckoutLine[]): Promise<PricedLine[]> {
    const skus = lines.map((line) => line.sku);
    const pointers = await catalog.resolveSkus(skus);
    const variants = await catalog.loadVariants([...pointers.values()]);

    return lines.map((line) => {
      const pointer = pointers.get(line.sku);
      const variant = variants.get(line.sku);

      if (pointer === undefined || variant === undefined) {
        throw new NotFoundError(`No such sku: ${line.sku}`);
      }

      return {
        line: {
          sku: line.sku,
          productId: pointer.productId,
          categoryId: pointer.categoryId,
          qty: line.qty,
          unitPrice: variant.price,
        },
        buckets: variant.stockBuckets,
      };
    });
  }

  return {
    /**
     * AP7. Returns the placed order, or the original one when this request was already handled.
     */
    async checkout(request: CheckoutRequest, now = new Date()): Promise<CheckoutResult> {
      if (request.lines.length === 0) {
        throw new ValidationError('An order needs at least one line');
      }
      if (request.lines.length > MAX_CHECKOUT_LINES) {
        throw new ValidationError(`An order may have at most ${String(MAX_CHECKOUT_LINES)} lines`, {
          lines: request.lines.length,
        });
      }

      const priced = await priceLines(request.lines);
      const lines = priced.map((entry) => entry.line);

      // Hashed from what the client asked for, not from what the server priced it at, so a retry
      // matches even if the catalog price moved in between.
      const hash = requestHash({
        lines: request.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
      });

      // One id for the whole request: a cancelled transaction writes nothing, so reusing it across
      // attempts keeps the logs readable without risking a duplicate.
      const orderId = newOrderId();

      const exhausted = new Map<Sku, Set<number>>();
      // An empty bucket is not contention, so rotations and conflict retries get separate budgets.
      const rotations = priced.reduce((total, entry) => total + entry.buckets, 0);
      let conflicts = 0;

      for (let attempt = 0; attempt < MAX_CONFLICT_ATTEMPTS + rotations; attempt += 1) {
        const allocations = chooseBuckets(priced, exhausted);
        const order = draftOrder({
          orderId,
          customerId: request.customerId,
          lines,
          allocations,
          now,
        });

        try {
          await documentClient().send(
            new TransactWriteCommand({
              TransactItems: checkoutItems({
                table: commerce(),
                request,
                order,
                lines,
                hash,
                now,
              }),
            }),
          );

          count(MetricName.OrdersPlaced);
          return { order, replayed: false };
        } catch (error: unknown) {
          if (!isTransactionCancelled(error)) {
            throw error;
          }

          const verdict = classifyCancellation(cancellationReasons(error), allocations);

          switch (verdict.kind) {
            case 'replay':
              return await this.replay(request, hash);

            case 'rotate':
              rememberEmptyBuckets(verdict.empty, priced, exhausted);
              logger.debug('Stock bucket empty, rotating', { attempt });
              continue;

            case 'conflict':
              conflicts += 1;
              count(MetricName.TxConflictRetries);
              if (conflicts >= MAX_CONFLICT_ATTEMPTS) {
                throw new ConflictError('Too much contention on checkout, please retry');
              }
              await sleep(jitteredBackoffMs(conflicts));
              continue;

            default:
              throw error;
          }
        }
      }

      throw new ConflictError('Too much contention on checkout, please retry');
    },

    /** Returns the order an earlier request with this idempotency key created. */
    async replay(request: CheckoutRequest, hash: string): Promise<CheckoutResult> {
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

      const order = await this.getOrder(request.customerId, parseOrderId(record.orderId));
      if (order === null) {
        throw new ConflictError('The original order could not be read, please retry');
      }

      count(MetricName.IdempotentReplays);
      return { order, replayed: true };
    },

    async getOrder(customerId: CustomerId, orderId: OrderId): Promise<Order | null> {
      const result = await documentClient().send(
        new GetCommand({
          TableName: commerce(),
          Key: orderKey(customerId, orderId),
          ConsistentRead: true,
        }),
      );

      return result.Item === undefined ? null : orderFromItem(result.Item);
    },

    /**
     * AP8 and AP9: a customer's orders, newest first.
     *
     * Without a status it is a Query on the table partition with `begins_with(SK, ORDER#)`. With
     * one it is the same partition read through the LSI, filtered by `begins_with(LSI1SK,
     * STATUS#<status>#)`.
     *
     * Both are strongly consistent, and the status one can only be: a GSI is always eventually
     * consistent, so the "open orders" view would keep showing an order the customer just
     * cancelled. That is the whole argument for customer-status-index being local.
     *
     * ScanIndexForward=false is all the ordering needed, because order ids are ULIDs and sort by
     * creation time.
     */
    async listOrders(query: ListOrdersQuery): Promise<Page<Order>> {
      const startKey = decodeCursor(query.cursor);
      const byStatus = query.status !== undefined;

      const result = await documentClient().send(
        new QueryCommand({
          TableName: commerce(),
          ...(byStatus ? { IndexName: STATUS_LSI_INDEX.name } : {}),
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
          ExpressionAttributeNames: {
            '#pk': PARTITION_ATTRIBUTE,
            '#sk': byStatus ? STATUS_LSI_ATTRIBUTE : SORT_ATTRIBUTE,
          },
          ExpressionAttributeValues: {
            ':pk': customerPartition(query.customerId),
            ':prefix':
              query.status === undefined ? orderSkPrefix() : orderStatusLsiPrefix(query.status),
          },
          ScanIndexForward: false,
          ConsistentRead: true,
          Limit: pageSize(query.limit),
          ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
        }),
      );

      return {
        items: (result.Items ?? []).map(orderFromItem),
        cursor: encodeCursor(result.LastEvaluatedKey),
      };
    },

    /**
     * AP11: `UpdateItem` conditional on the current status and version.
     *
     * The condition is the lock: two warehouse screens acting on the same order cannot both win,
     * and the loser is told its view is stale rather than silently overwriting.
     *
     * Leaving a status that needs fulfilment also removes the fulfillment index keys, which is how
     * a shipped order leaves the queue without being deleted.
     */
    async updateStatus(
      customerId: CustomerId,
      orderId: OrderId,
      change: StatusChange,
      now = new Date(),
    ): Promise<Order> {
      if (!canTransition(change.from, change.to)) {
        // Refused by the domain before a request is made: an impossible transition is not a
        // database problem.
        throw new InvalidTransitionError(change.from, change.to);
      }

      const leavesQueue = needsFulfillment(change.from) && !needsFulfillment(change.to);

      try {
        const result = await documentClient().send(
          new UpdateCommand({
            TableName: commerce(),
            Key: orderKey(customerId, orderId),
            UpdateExpression: [
              'SET #status = :to, #lsi = :lsi, updatedAt = :now, version = version + :one',
              leavesQueue ? 'REMOVE #gsi1pk, #gsi1sk' : '',
            ]
              .filter((part) => part.length > 0)
              .join(' '),
            ConditionExpression: '#status = :from AND version = :expected',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#lsi': STATUS_LSI_ATTRIBUTE,
              ...(leavesQueue
                ? {
                    '#gsi1pk': FULFILLMENT_INDEX_ATTRIBUTES.partition,
                    '#gsi1sk': FULFILLMENT_INDEX_ATTRIBUTES.sort,
                  }
                : {}),
            },
            ExpressionAttributeValues: {
              ':to': change.to,
              ':from': change.from,
              ':lsi': orderStatusLsiSk(change.to, orderId),
              ':now': now.toISOString(),
              ':expected': change.expectedVersion,
              ':one': 1,
            },
            ReturnValues: 'ALL_NEW',
          }),
        );

        return orderFromItem(result.Attributes);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          throw new ConflictError(
            'That order has changed since it was read, please read it again and retry',
            { expectedVersion: change.expectedVersion },
          );
        }
        throw error;
      }
    },

    /**
     * AP11, the cancel case: a transaction, because the units have to go back.
     *
     * Each allocation is credited to the bucket it came from, which is why the order records them:
     * the writer picked that bucket at random and nothing can recompute it. Doing this as two
     * writes would risk a cancelled order whose stock was never returned.
     */
    async cancelOrder(
      customerId: CustomerId,
      orderId: OrderId,
      expectedVersion: number,
      now = new Date(),
    ): Promise<Order> {
      const order = await this.getOrder(customerId, orderId);
      if (order === null) {
        throw new NotFoundError('No such order');
      }
      if (!canTransition(order.status, 'CANCELLED')) {
        throw new InvalidTransitionError(order.status, 'CANCELLED');
      }

      const returning = holdsStock(order.status) ? order.allocations : [];

      try {
        await documentClient().send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: commerce(),
                  Key: orderKey(customerId, orderId),
                  UpdateExpression:
                    'SET #status = :cancelled, #lsi = :lsi, updatedAt = :now, version = version + :one REMOVE #gsi1pk, #gsi1sk',
                  ConditionExpression: '#status = :from AND version = :expected',
                  ExpressionAttributeNames: {
                    '#status': 'status',
                    '#lsi': STATUS_LSI_ATTRIBUTE,
                    '#gsi1pk': FULFILLMENT_INDEX_ATTRIBUTES.partition,
                    '#gsi1sk': FULFILLMENT_INDEX_ATTRIBUTES.sort,
                  },
                  ExpressionAttributeValues: {
                    ':cancelled': 'CANCELLED',
                    ':from': order.status,
                    ':lsi': orderStatusLsiSk('CANCELLED', orderId),
                    ':now': now.toISOString(),
                    ':expected': expectedVersion,
                    ':one': 1,
                  },
                },
              },
              ...returning.map((allocation) => ({
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
        if (isTransactionCancelled(error)) {
          throw new ConflictError(
            'That order has changed since it was read, please read it again and retry',
            { expectedVersion },
          );
        }
        throw error;
      }

      const cancelled = await this.getOrder(customerId, orderId);
      if (cancelled === null) {
        throw new NotFoundError('No such order');
      }
      return cancelled;
    },

    /**
     * AP10: an order's lines, from their own partition.
     *
     * Eventually consistent on purpose: lines are immutable once written, so there is nothing
     * newer to miss.
     */
    async getOrderLines(orderId: OrderId): Promise<OrderLine[]> {
      const result = await documentClient().send(
        new QueryCommand({
          TableName: commerce(),
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': PARTITION_ATTRIBUTE },
          ExpressionAttributeValues: { ':pk': orderLinePartition(orderId) },
        }),
      );

      return (result.Items ?? []).map(orderLineFromItem);
    },
  };
}
