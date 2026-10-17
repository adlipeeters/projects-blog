/**
 * Powertools tracer. X-Ray active tracing is on for every function (spec section 11), and the
 * tracer captures SDK calls, so a checkout trace shows each DynamoDB call as its own subsegment.
 */

import { Tracer } from '@aws-lambda-powertools/tracer';

export const tracer = new Tracer({
  serviceName: process.env['SERVICE_NAME'] ?? 'dropzone',
});
