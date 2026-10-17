/**
 * Creates DynamoDB Local tables from schema/tables.json.
 *
 * This is the half of the no-drift promise that faces the tests: Terraform reads the same file, so
 * an index the tests query cannot be missing from the deployed table, and a key attribute cannot
 * be named differently in the two places (spec section 2).
 */

import {
  CreateTableCommand,
  type CreateTableCommandInput,
  type DynamoDBClient,
  type GlobalSecondaryIndex,
  type LocalSecondaryIndex,
  type Projection,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';

import schema from '../../../schema/tables.json' with { type: 'json' };

type TableKey = keyof typeof schema.tables;
type TableSchema = (typeof schema.tables)[TableKey];

export const TABLE_KEYS = Object.keys(schema.tables) as readonly TableKey[];

/** Test table names are prefixed per run, so two suites never share state. */
export const tableName = (key: TableKey, prefix: string): string =>
  `${prefix}-${schema.tables[key].nameSuffix}`;

const projectionOf = (index: {
  projectionType: string;
  nonKeyAttributes?: readonly string[];
}): Projection => ({
  ProjectionType: index.projectionType as Projection['ProjectionType'],
  ...(index.projectionType === 'INCLUDE' && index.nonKeyAttributes !== undefined
    ? { NonKeyAttributes: [...index.nonKeyAttributes] }
    : {}),
});

const createTableInput = (table: TableSchema, name: string): CreateTableCommandInput => {
  const gsis: GlobalSecondaryIndex[] = table.globalSecondaryIndexes.map((index) => ({
    IndexName: index.name,
    KeySchema: [
      { AttributeName: index.hashKey, KeyType: 'HASH' },
      ...(index.rangeKey === undefined
        ? []
        : [{ AttributeName: index.rangeKey, KeyType: 'RANGE' as const }]),
    ],
    Projection: projectionOf(index),
    // DynamoDB Local ignores capacity, but the API still requires it for a provisioned table.
    ...(table.billingMode === 'PROVISIONED'
      ? { ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 } }
      : {}),
  }));

  const lsis: LocalSecondaryIndex[] = table.localSecondaryIndexes.map((index) => ({
    IndexName: index.name,
    KeySchema: [
      { AttributeName: table.hashKey, KeyType: 'HASH' },
      { AttributeName: index.rangeKey, KeyType: 'RANGE' },
    ],
    Projection: projectionOf(index),
  }));

  return {
    TableName: name,
    AttributeDefinitions: table.attributes.map((attribute) => ({
      AttributeName: attribute.name,
      AttributeType: attribute.type as 'S' | 'N' | 'B',
    })),
    KeySchema: [
      { AttributeName: table.hashKey, KeyType: 'HASH' },
      { AttributeName: table.rangeKey, KeyType: 'RANGE' },
    ],
    BillingMode: table.billingMode as 'PROVISIONED' | 'PAY_PER_REQUEST',
    ...(table.billingMode === 'PROVISIONED'
      ? { ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 } }
      : {}),
    ...(gsis.length > 0 ? { GlobalSecondaryIndexes: gsis } : {}),
    ...(lsis.length > 0 ? { LocalSecondaryIndexes: lsis } : {}),
    // `in` rather than a truthiness check: the catalog table's stream entry has no viewType at all,
    // and that is what tells TypeScript the two shapes apart.
    ...(table.stream.enabled && 'viewType' in table.stream
      ? {
          StreamSpecification: {
            StreamEnabled: true,
            StreamViewType: table.stream.viewType as 'NEW_AND_OLD_IMAGES',
          },
        }
      : {}),
  };
};

/**
 * Creates every table in the schema under the given prefix and returns their names.
 *
 * TTL is enabled where the schema says so, but DynamoDB Local never actually expires items: TTL
 * deletion is one of the three things only AWS can test (spec section 11).
 */
export async function createTables(
  client: DynamoDBClient,
  prefix: string,
): Promise<Record<TableKey, string>> {
  const names = {} as Record<TableKey, string>;

  for (const key of TABLE_KEYS) {
    const table = schema.tables[key];
    const name = tableName(key, prefix);

    await client.send(new CreateTableCommand(createTableInput(table, name)));

    if (table.ttlAttribute !== null) {
      await client.send(
        new UpdateTimeToLiveCommand({
          TableName: name,
          TimeToLiveSpecification: { Enabled: true, AttributeName: table.ttlAttribute },
        }),
      );
    }

    names[key] = name;
  }

  return names;
}
