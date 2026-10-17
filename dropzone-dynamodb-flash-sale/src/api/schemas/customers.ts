/**
 * Request and response DTOs for customer registration (AP5).
 */

import { z } from 'zod';

import type { Customer } from '../../domain/customer.js';
import { ValidationError } from '../../shared/errors.js';

const registerCustomerSchema = z.object({
  // Zod's email check is deliberately the only format rule: the address is lowercased and used as a
  // partition key, never parsed for meaning.
  email: z.string().email().max(254),
  name: z.string().trim().min(1).max(100),
});

export type RegisterCustomerRequest = z.infer<typeof registerCustomerSchema>;

export function parseRegisterCustomer(body: unknown): RegisterCustomerRequest {
  const result = registerCustomerSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(
      `Invalid request: ${issue === undefined ? 'unknown field' : `${issue.path.join('.')} ${issue.message.toLowerCase()}`}`,
    );
  }
  return result.data;
}

export type CustomerDto = {
  readonly customerId: string;
  readonly email: string;
  readonly name: string;
  readonly createdAt: string;
};

export const toCustomerResponse = (customer: Customer): CustomerDto => ({
  customerId: customer.customerId,
  email: customer.email,
  name: customer.name,
  createdAt: customer.createdAt,
});
