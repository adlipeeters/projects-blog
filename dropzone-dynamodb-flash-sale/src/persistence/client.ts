/**
 * The DynamoDB document client, one per container.
 *
 * `DynamoDBDocumentClient` converts plain JavaScript values to and from attribute values, which is
 * as much abstraction as this project wants. There is no ORM on purpose: key design has to stay
 * visible in the call site (spec section 2).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { tracer } from '../shared/tracer.js';

const inLambda = (): boolean => process.env['AWS_LAMBDA_FUNCTION_NAME'] !== undefined;

const buildClient = (): DynamoDBDocumentClient => {
  // Integration tests point this at DynamoDB Local in a container.
  const endpoint = process.env['DYNAMODB_ENDPOINT'];

  const base = new DynamoDBClient({
    ...(endpoint === undefined ? {} : { endpoint }),
    maxAttempts: 4,
  });

  // Makes every call its own X-Ray subsegment, so a checkout trace shows each DynamoDB operation.
  // Only inside Lambda: outside one there is no segment to attach to.
  const instrumented = inLambda() ? tracer.captureAWSv3Client(base) : base;

  return DynamoDBDocumentClient.from(instrumented, {
    marshallOptions: {
      // An absent attribute and an attribute set to null are different things in DynamoDB, and
      // sparse indexes depend on absence. Dropping undefined keeps that distinction honest.
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
    unmarshallOptions: {
      // Numbers stay numbers. Nothing in this schema needs more precision than a JS number, and
      // money is in integer cents anyway.
      wrapNumbers: false,
    },
  });
};

let cached: DynamoDBDocumentClient | undefined;

export function documentClient(): DynamoDBDocumentClient {
  cached ??= buildClient();
  return cached;
}

/** Tests only: drop the cached client so the next call reads a new endpoint. */
export function resetDocumentClient(): void {
  cached?.destroy();
  cached = undefined;
}
