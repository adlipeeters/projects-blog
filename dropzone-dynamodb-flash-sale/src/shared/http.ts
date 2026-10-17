/**
 * The HTTP boundary every route shares: log context, error mapping, metric flushing.
 *
 * No middleware framework on purpose. The wrapper is ten lines of visible control flow, which is
 * easier to reason about (and to put in an article) than a middleware chain.
 *
 * X-Ray needs no wiring here: Lambda opens the segment when active tracing is on, and
 * constructing the Powertools tracer patches the AWS SDK, so every DynamoDB call becomes a
 * subsegment on its own.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';

import { addLogContext, clearLogContext, logger } from './logger.js';
import { metrics } from './metrics.js';
import { ValidationError, isAppError, toErrorResponse } from './errors.js';

export type HttpResult = {
  readonly status: number;
  readonly body?: unknown;
};

export const ok = (body: unknown): HttpResult => ({ status: 200, body });
export const created = (body: unknown): HttpResult => ({ status: 201, body });
export const noContent = (): HttpResult => ({ status: 204 });

/**
 * The request body as unstructured JSON, for a Zod schema to validate.
 *
 * API Gateway base64-encodes the body when the client says the content is binary, so both shapes
 * have to be handled or a perfectly good request fails on a parse error.
 */
export function jsonBody(event: APIGatewayProxyEventV2): unknown {
  if (event.body === undefined || event.body.length === 0) {
    throw new ValidationError('A JSON body is required');
  }

  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Body is not valid JSON');
  }
}

export type RouteHandler = (event: APIGatewayProxyEventV2, context: Context) => Promise<HttpResult>;

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

const render = (result: HttpResult): APIGatewayProxyStructuredResultV2 =>
  result.body === undefined
    ? { statusCode: result.status }
    : { statusCode: result.status, headers: JSON_HEADERS, body: JSON.stringify(result.body) };

/**
 * Wraps a route. `route` is the logical name used in logs and metrics dimensions, for example
 * `get-product`.
 */
export function httpRoute(route: string, handler: RouteHandler) {
  return async (
    event: APIGatewayProxyEventV2,
    context: Context,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const customerId = event.headers['x-customer-id'];
    addLogContext({
      requestId: context.awsRequestId,
      ...(customerId === undefined ? {} : { customerId }),
    });

    try {
      return render(await handler(event, context));
    } catch (error: unknown) {
      const { status, body } = toErrorResponse(error);

      // Client errors are expected traffic; server errors are bugs and carry the stack.
      if (status >= 500) {
        logger.error('Route failed', { route, error: error as Error });
      } else {
        logger.warn('Route rejected request', {
          route,
          code: body.code,
          ...(isAppError(error) ? error.details : {}),
        });
      }

      return render({ status, body });
    } finally {
      // Publishing an empty set only logs a Powertools warning, so routes that record nothing
      // stay quiet.
      if (metrics.hasStoredMetrics()) {
        metrics.publishStoredMetrics();
      }
      clearLogContext();
    }
  };
}
