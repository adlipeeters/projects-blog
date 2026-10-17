/**
 * Powertools metrics in the `Dropzone` namespace (spec section 11).
 *
 * The names are a closed set so a typo cannot create a new, silently empty metric.
 */

import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

export const metrics = new Metrics({
  namespace: 'Dropzone',
  serviceName: process.env['SERVICE_NAME'] ?? 'dropzone',
});

export const MetricName = {
  OrdersPlaced: 'OrdersPlaced',
  CheckoutSoldOut: 'CheckoutSoldOut',
  TxConflictRetries: 'TxConflictRetries',
  IdempotentReplays: 'IdempotentReplays',
  HoldsReleasedBySweeper: 'HoldsReleasedBySweeper',
  HoldExpiredUnreleased: 'HoldExpiredUnreleased',
} as const;

export type MetricName = (typeof MetricName)[keyof typeof MetricName];

export function count(name: MetricName, value = 1): void {
  metrics.addMetric(name, MetricUnit.Count, value);
}
