/**
 * One DynamoDB Local container per test file, with the project's own tables inside it.
 *
 * Needs Docker. What this cannot cover is listed in spec section 11: TTL deletion, throttling and
 * global table replication are tested on AWS in test/e2e.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

import { resetDocumentClient } from '../../../src/persistence/client.js';
import { createTables } from './tables.js';

const IMAGE = 'amazon/dynamodb-local:2.5.2';
const PORT = 8000;

export type Harness = {
  readonly endpoint: string;
  readonly client: DynamoDBDocumentClient;
  readonly tables: Record<'catalog' | 'commerce' | 'carts', string>;
  readonly stop: () => Promise<void>;
};

/**
 * Starts the container, creates the tables and points the application's own client at it by setting
 * DYNAMODB_ENDPOINT, so repositories under test build their client exactly as they do in Lambda.
 */
export async function startHarness(prefix: string): Promise<Harness> {
  const container: StartedTestContainer = await new GenericContainer(IMAGE)
    .withExposedPorts(PORT)
    .withCommand(['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb'])
    .start();

  const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(PORT))}`;

  // DynamoDB Local requires credentials to be present but does not check them.
  process.env['AWS_REGION'] = 'eu-central-1';
  process.env['AWS_ACCESS_KEY_ID'] = 'local';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'local';
  process.env['DYNAMODB_ENDPOINT'] = endpoint;
  resetDocumentClient();

  const raw = new DynamoDBClient({ endpoint });
  const tables = await createTables(raw, prefix);

  process.env['CATALOG_TABLE'] = tables.catalog;
  process.env['COMMERCE_TABLE'] = tables.commerce;
  process.env['CARTS_TABLE'] = tables.carts;

  return {
    endpoint,
    client: DynamoDBDocumentClient.from(raw),
    tables,
    stop: async () => {
      raw.destroy();
      resetDocumentClient();
      delete process.env['DYNAMODB_ENDPOINT'];
      await container.stop();
    },
  };
}
