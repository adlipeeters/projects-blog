/**
 * The customer repository: AP5 and AP6.
 *
 * AP5 is the project's first transaction, and the simplest illustration of why transactions exist
 * here: a customer and the item that makes its email unique have to appear together or not at all.
 */

import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import type { Customer } from '../../domain/customer.js';
import type { CustomerId } from '../../domain/ids.js';
import { customerId as parseCustomerId, newCustomerId, normalizeEmail } from '../../domain/ids.js';
import { ConflictError } from '../../shared/errors.js';
import { commerceTable } from '../../shared/env.js';
import { documentClient } from '../client.js';
import { customerKey, emailMarkerKey, PARTITION_ATTRIBUTE } from '../keys.js';
import {
  customerFromItem,
  customerIdFromEmailMarker,
  customerToItem,
  emailMarkerToItem,
} from '../mappers/customer.js';

export type RegisterCustomer = {
  readonly email: string;
  readonly name: string;
};

const isTransactionCancelled = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TransactionCanceledException';

export function customerRepository() {
  const table = (): string => commerceTable();

  return {
    /**
     * AP5: `TransactWriteItems` with `attribute_not_exists(PK)` on both items.
     *
     * The marker's condition is what enforces uniqueness. The customer's own condition guards
     * against reusing an id, which a ULID collision would need, and costs nothing to add.
     *
     * A transaction, not two writes: without it, a failed second write leaves a customer whose
     * email nothing points at, and a retry would then create a duplicate.
     */
    async register(input: RegisterCustomer, now = new Date()): Promise<Customer> {
      const customer: Customer = {
        customerId: newCustomerId(),
        email: normalizeEmail(input.email),
        name: input.name,
        createdAt: now.toISOString(),
      };

      try {
        await documentClient().send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: table(),
                  Item: customerToItem(customer),
                  ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
                },
              },
              {
                Put: {
                  TableName: table(),
                  Item: emailMarkerToItem(customer),
                  ConditionExpression: `attribute_not_exists(${PARTITION_ATTRIBUTE})`,
                },
              },
            ],
          }),
        );
      } catch (error: unknown) {
        if (isTransactionCancelled(error)) {
          // Only one condition in this transaction can realistically fail, so the reason is known
          // without reading CancellationReasons. Checkout in AP7 has four, and does read them.
          throw new ConflictError('That email address is already registered');
        }
        throw error;
      }

      return customer;
    },

    /**
     * AP6: `GetItem PK = EMAIL#<email>`, strongly consistent.
     *
     * Strong because a signup immediately followed by a sign-in must not miss the marker it just
     * wrote. It is a GetItem on the base table, so strong consistency is available at all, which a
     * GSI would not offer.
     */
    async findIdByEmail(email: string): Promise<CustomerId | null> {
      const result = await documentClient().send(
        new GetCommand({
          TableName: table(),
          Key: emailMarkerKey(normalizeEmail(email)),
          ConsistentRead: true,
        }),
      );

      return result.Item === undefined ? null : customerIdFromEmailMarker(result.Item);
    },

    async getCustomer(customerId: CustomerId): Promise<Customer | null> {
      const result = await documentClient().send(
        new GetCommand({
          TableName: table(),
          Key: customerKey(customerId),
          ConsistentRead: true,
        }),
      );

      return result.Item === undefined ? null : customerFromItem(result.Item);
    },

    /** Used by handlers that receive a customer id in a header and must confirm it exists. */
    async requireCustomer(raw: string): Promise<Customer | null> {
      return this.getCustomer(parseCustomerId(raw));
    },
  };
}
