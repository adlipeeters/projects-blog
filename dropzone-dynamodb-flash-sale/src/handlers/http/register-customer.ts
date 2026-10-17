/**
 * `POST /customers` (AP5, AP6).
 *
 * One transaction writes the customer and the item that makes its email unique. A duplicate email
 * is a 409, from the condition failing rather than from a read-then-write check, which two
 * simultaneous signups would both pass.
 */

import { parseRegisterCustomer, toCustomerResponse } from '../../api/schemas/customers.js';
import { customerRepository } from '../../persistence/repositories/customers.js';
import { created, httpRoute, jsonBody } from '../../shared/http.js';
import { addLogContext } from '../../shared/logger.js';

const customers = customerRepository();

export const handler = httpRoute('register-customer', async (event) => {
  const input = parseRegisterCustomer(jsonBody(event));

  const customer = await customers.register(input);
  // The email is never logged: logs carry ids, not personal data (spec section 11).
  addLogContext({ customerId: customer.customerId });

  return created(toCustomerResponse(customer));
});
