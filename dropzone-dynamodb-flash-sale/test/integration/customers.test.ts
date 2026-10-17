/**
 * AP5 and AP6 against DynamoDB Local.
 *
 * | AP  | Access pattern                         | Operation                                      |
 * | --- | -------------------------------------- | ---------------------------------------------- |
 * | AP5 | Register a customer with a unique email | TransactWriteItems: customer + email marker    |
 * | AP6 | Find a customer by email                | GetItem PK = EMAIL#<email>, strongly consistent |
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newCustomerId } from '../../src/domain/ids.js';
import { customerRepository } from '../../src/persistence/repositories/customers.js';
import { startHarness, type Harness } from './support/harness.js';

let harness: Harness;
let customers: ReturnType<typeof customerRepository>;

beforeAll(async () => {
  harness = await startHarness('dropzone-test-customers');
  customers = customerRepository();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe('AP5: register a customer with a unique email', () => {
  it('writes the customer and its email marker in one transaction', async () => {
    const customer = await customers.register({ email: 'ada@example.test', name: 'Ada' });

    expect(customer.email).toBe('ada@example.test');
    expect(customer.name).toBe('Ada');

    const found = await customers.getCustomer(customer.customerId);
    expect(found?.name).toBe('Ada');

    // AP6 finds the same customer through the marker.
    expect(await customers.findIdByEmail('ada@example.test')).toBe(customer.customerId);
  });

  it('refuses a second signup with the same email', async () => {
    await customers.register({ email: 'grace@example.test', name: 'Grace' });

    await expect(
      customers.register({ email: 'grace@example.test', name: 'Imposter' }),
    ).rejects.toThrow('already registered');
  });

  it('treats email case and surrounding space as the same address', async () => {
    const customer = await customers.register({ email: 'Alan@Example.test', name: 'Alan' });

    // The key is built from the lowercased address, so these are one partition, not three.
    expect(customer.email).toBe('alan@example.test');
    await expect(
      customers.register({ email: '  ALAN@EXAMPLE.TEST ', name: 'Imposter' }),
    ).rejects.toThrow('already registered');

    expect(await customers.findIdByEmail('alan@example.test')).toBe(customer.customerId);
  });

  it('leaves no customer behind when the email is taken', async () => {
    await customers.register({ email: 'katherine@example.test', name: 'Katherine' });

    const before = await customers.findIdByEmail('katherine@example.test');

    await expect(
      customers.register({ email: 'katherine@example.test', name: 'Imposter' }),
    ).rejects.toThrow('already registered');

    // The transaction is all or nothing: the loser's customer item was never written, and the
    // marker still points at the original. Two writes without a transaction would leave an orphan.
    expect(await customers.findIdByEmail('katherine@example.test')).toBe(before);
    expect((await customers.getCustomer(before!))?.name).toBe('Katherine');
  });

  it('lets exactly one of many concurrent signups win', async () => {
    const attempts = 20;

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, n) =>
        customers.register({ email: 'race@example.test', name: `Racer ${String(n)}` }),
      ),
    );

    const won = results.filter((result) => result.status === 'fulfilled');
    expect(won).toHaveLength(1);

    // Everything else failed for the documented reason, not with an unexpected error.
    for (const result of results.filter((r) => r.status === 'rejected')) {
      expect(result.reason).toMatchObject({ code: 'CONFLICT' });
    }
  });
});

describe('AP6: find a customer by email', () => {
  it('returns null for an unknown email', async () => {
    expect(await customers.findIdByEmail('nobody@example.test')).toBeNull();
  });

  it('returns null for a customer id that does not exist', async () => {
    expect(await customers.getCustomer(newCustomerId())).toBeNull();
  });
});
