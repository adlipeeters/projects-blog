/**
 * Powertools logger, one instance per container.
 *
 * Spec section 11: JSON logs with `requestId`, `customerId`, `orderId` or `holdId` on every line,
 * and no emails or names.
 */

import { Logger } from '@aws-lambda-powertools/logger';

export const logger = new Logger({
  serviceName: process.env['SERVICE_NAME'] ?? 'dropzone',
});

/** Fields added to every log line for the rest of this invocation. */
export type LogContext = {
  readonly requestId?: string;
  readonly customerId?: string;
  readonly orderId?: string;
  readonly holdId?: string;
  readonly cartId?: string;
  readonly sku?: string;
};

export function addLogContext(context: LogContext): void {
  logger.appendKeys({ ...context });
}

export function clearLogContext(): void {
  logger.resetKeys();
}
