/**
 * Deletes every seeded catalog item, one category at a time.
 *
 * Needed between load runs in section 9, and after a partial seed. It never uses Scan (the project
 * allows exactly one, in the section 10 backfill): the category index lists the products, and each
 * product's partition lists its own items.
 *
 *   CATALOG_TABLE=dropzone-dev-catalog pnpm reset-catalog
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { batchWriteAll } from '../src/persistence/batch.js';
import { documentClient } from '../src/persistence/client.js';
import {
  CATEGORY_PRICE_INDEX,
  KEY_ATTRIBUTES,
  PARTITION_ATTRIBUTE,
  categoryIndexPk,
  partitionKeyOf,
  productPartition,
} from '../src/persistence/keys.js';
import { catalogTable } from '../src/shared/env.js';

const CATEGORIES = ['tees', 'hoodies', 'caps', 'jackets', 'socks'];

const keyOf = (item: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(KEY_ATTRIBUTES.map((attribute) => [attribute, item[attribute]]));

async function main(): Promise<void> {
  const table = catalogTable();
  let deleted = 0;

  for (const category of CATEGORIES) {
    // Every product of the category, from the index.
    const products: string[] = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const page = await documentClient().send(
        new QueryCommand({
          TableName: table,
          IndexName: CATEGORY_PRICE_INDEX.name,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': CATEGORY_PRICE_INDEX.partitionAttribute },
          ExpressionAttributeValues: { ':pk': categoryIndexPk(category) },
          ...(cursor === undefined ? {} : { ExclusiveStartKey: cursor }),
        }),
      );

      for (const item of page.Items ?? []) {
        const partition = partitionKeyOf(item);
        if (typeof partition === 'string') {
          products.push(partition);
        }
      }
      cursor = page.LastEvaluatedKey;
    } while (cursor !== undefined);

    // Then every item in each product's partition: the META item and all variants.
    for (const partition of products) {
      const items = await documentClient().send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': PARTITION_ATTRIBUTE },
          ExpressionAttributeValues: { ':pk': partition },
          ProjectionExpression: KEY_ATTRIBUTES.join(', '),
        }),
      );

      deleted += await batchWriteAll(
        table,
        (items.Items ?? []).map((item) => ({ DeleteRequest: { Key: keyOf(item) } })),
      );
    }

    console.log(`${category}: ${String(products.length)} products cleared`);
  }

  console.log(`Deleted ${String(deleted)} items from ${table}`);
  console.log(
    `Note: ${productPartition('<id>')} partitions outside these categories are untouched.`,
  );
}

await main();
