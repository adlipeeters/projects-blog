/**
 * The order repository. AP7: place an order, in one transaction.
 *
 * The shape of the transaction is the design (spec section 7):
 *
 *   1. put the idempotency item, condition attribute_not_exists       <- this request is new
 *   2. for each line, decrement a stock bucket, condition available >= qty  <- the units exist
 *   3. put the order header, condition attribute_not_exists
 *   4. put each order line
 *
 * All of it happens or none of it does, which makes "no oversell, no double order, no lost stock" a
 * property of the database rather than of careful code. A transaction allows up to 100 actions and
 * costs 2 write units per item, so the 20-line cap keeps every checkout well inside the limit.
 *
 * Nothing is written when a transaction is cancelled, so a failed attempt leaves no idempotency key
 * and no half-order behind.
 */

import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import type { CustomerId, OrderId, Sku } from '../../domain/ids.js';
import { newOrderId, orderId as parseOrderId } from '../../domain/ids.js';
import type { Allocation, Order, OrderLine } from '../../domain/order.js';
import { orderTotal } from '../../domain/order.js';
import { bucketOrder } from '../../domain/stock.js';
import { commerceTable } from '../../shared/env.js';
import {
  ConflictError,
  IdempotencyMismatchError,
  NotFoundError,
  SoldOutError,
  ValidationError,
} from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { MetricName, count } from '../../shared/metrics.js';
import { requestHash } from '../../shared/request-hash.js';
import { IDEMPOTENCY_TTL_HOURS, ttlInHours } from '../../shared/ttl.js';
import { documentClient } from '../client.js';
import {
  PARTITION_ATTRIBUTE,
  idempotencyKey,
  orderKey,
  orderLinePartition,
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

export function orderRepository(catalog = catalogRepository()) {
  const commerce = (): string => commerceTable();

  /** Prices and bucket counts come from the catalog, never from the client (spec section 7). */
  async function priceLines(
    lines: readonly CheckoutLine[],
  ): Promise<{ readonly line: OrderLine; readonly buckets: number }[]> {
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

      // The hash covers what the client asked for, not what the server priced it at, so a retry of
      // the same request matches even if the catalog price changed in between.
      const hash = requestHash({
        lines: request.lines.map((line) => ({ sku: line.sku, qty: line.qty })),
      });

      // One id for the whole request: a cancelled transaction writes nothing, so reusing it across
      // attempts keeps the logs readable without risking a duplicate.
      const orderId = newOrderId();

      /** Buckets this request has already found empty, per sku. */
      const exhausted = new Map<Sku, Set<number>>();

      // Rotating past an empty bucket is not a conflict retry, so each gets its own budget.
      const rotationBudget = priced.reduce((total, entry) => total + entry.buckets, 0);
      let conflicts = 0;

      for (let iteration = 0; iteration < MAX_CONFLICT_ATTEMPTS + rotationBudget; iteration += 1) {
        const allocations = priced.map((entry): Allocation => {
          const skipped = exhausted.get(entry.line.sku) ?? new Set<number>();
          const bucket = bucketOrder(entry.buckets).find((candidate) => !skipped.has(candidate));

          if (bucket === undefined) {
            count(MetricName.CheckoutSoldOut);
            throw new SoldOutError(entry.line.sku);
          }

          return { sku: entry.line.sku, bucket, qty: entry.line.qty };
        });

        const order: Order = {
          orderId,
          customerId: request.customerId,
          status: 'PLACED',
          total: orderTotal(lines),
          placedAt: now.toISOString(),
          updatedAt: now.toISOString(),
          allocations,
          version: 1,
        };

        // Positions, so a cancellation reason can be matched to what it refers to.
        const idempotencyPosition = 0;
        const stockPositions = allocations.map((_, index) => index + 1);

        try {
          await documentClient().send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Put: {
                    TableName: commerce(),
                    Item: idempotencyToItem({
                      customerId: request.customerId,
                      key: request.idempotencyKey,
                      orderId,
                      requestHash: hash,
                      ttl: ttlInHours(now, IDEMPOTENCY_TTL_HOURS),
                    }),
                    ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
                  },
                },
                ...allocations.map((allocation) => ({
                  Update: {
                    TableName: commerce(),
                    Key: stockBucketKey(allocation.sku, allocation.bucket),
                    UpdateExpression: 'SET available = available - :qty, version = version + :one',
                    // The whole no-oversell guarantee is this one line.
                    ConditionExpression: 'available >= :qty',
                    ExpressionAttributeValues: { ':qty': allocation.qty, ':one': 1 },
                    ReturnValuesOnConditionCheckFailure: 'ALL_OLD' as const,
                  },
                })),
                {
                  Put: {
                    TableName: commerce(),
                    Item: orderToItem(order),
                    ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
                  },
                },
                ...lines.map((line) => ({
                  Put: {
                    TableName: commerce(),
                    Item: orderLineToItem(orderId, request.customerId, line),
                  },
                })),
              ],
            }),
          );

          count(MetricName.OrdersPlaced);
          return { order, replayed: false };
        } catch (error: unknown) {
          if (!isTransactionCancelled(error)) {
            throw error;
          }

          const reasons = cancellationReasons(error);

          // The idempotency item already exists: this request has been handled before.
          if (reasons[idempotencyPosition]?.Code === CONDITION_FAILED) {
            return await this.replay(request, hash);
          }

          // A bucket could not satisfy its line. Remember it and rotate to another one.
          let rotated = false;
          for (const [index, position] of stockPositions.entries()) {
            if (reasons[position]?.Code !== CONDITION_FAILED) {
              continue;
            }

            const allocation = allocations[index];
            const entry = priced[index];
            if (allocation === undefined || entry === undefined) {
              continue;
            }

            const skipped = exhausted.get(allocation.sku) ?? new Set<number>();
            skipped.add(allocation.bucket);
            exhausted.set(allocation.sku, skipped);
            rotated = true;

            if (skipped.size >= entry.buckets) {
              count(MetricName.CheckoutSoldOut);
              throw new SoldOutError(allocation.sku);
            }
          }

          if (rotated) {
            logger.debug('Stock bucket empty, rotating', { iteration });
            continue;
          }

          // Contention on the same items. Retry with jittered backoff, a few times only.
          if (reasons.some((reason) => reason.Code === TRANSACTION_CONFLICT)) {
            conflicts += 1;
            count(MetricName.TxConflictRetries);

            if (conflicts >= MAX_CONFLICT_ATTEMPTS) {
              throw new ConflictError('Too much contention on checkout, please retry');
            }

            await sleep(jitteredBackoffMs(conflicts));
            continue;
          }

          throw error;
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
