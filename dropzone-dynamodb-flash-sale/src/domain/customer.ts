import type { CustomerId } from './ids.js';

export type Customer = {
  readonly customerId: CustomerId;
  /** Already lowercased. The email marker item in AP5 uses this value as its partition key. */
  readonly email: string;
  readonly name: string;
  readonly createdAt: string;
};
