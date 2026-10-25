/**
 * The boundary a scheduled or stream-driven function shares: log context, error logging, metric
 * flushing.
 *
 * The same ten lines of visible control flow as `httpRoute`, minus the request and response. A job
 * has no client to answer, so an error here is rethrown: the invocation has to fail for the
 * Lambda error metric, the retry and the alarm to mean anything.
 */

import type { Context } from 'aws-lambda';

import { addLogContext, clearLogContext, logger } from './logger.js';
import { metrics } from './metrics.js';

export type JobHandler<TEvent, TResult> = (event: TEvent, context: Context) => Promise<TResult>;

export function scheduledJob<TEvent, TResult>(job: string, handler: JobHandler<TEvent, TResult>) {
  return async (event: TEvent, context: Context): Promise<TResult> => {
    addLogContext({ requestId: context.awsRequestId });

    try {
      return await handler(event, context);
    } catch (error: unknown) {
      logger.error('Job failed', { job, error: error as Error });
      throw error;
    } finally {
      if (metrics.hasStoredMetrics()) {
        metrics.publishStoredMetrics();
      }
      clearLogContext();
    }
  };
}
