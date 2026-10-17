/**
 * Customer and its email marker.
 *
 * Two items, written in one transaction (AP5). The marker exists only so that a second signup with
 * the same email fails on `attribute_not_exists(PK)`: DynamoDB has no unique constraint other than
 * the primary key, so uniqueness on a non-key attribute has to be modelled as a second item whose
 * key *is* that attribute.
 */

import { z } from 'zod';

import type { Customer } from '../../domain/customer.js';
import { customerId, normalizeEmail } from '../../domain/ids.js';
import { EntityType, SCHEMA_VERSION } from '../entity-types.js';
import { customerKey, emailMarkerKey } from '../keys.js';
import { buildDomain, parseItem } from './parse.js';

const customerItemSchema = z.object({
  entityType: z.literal(EntityType.Customer),
  schemaVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  customerId: z.string(),
  email: z.string().min(3),
  name: z.string().min(1),
  createdAt: z.string(),
});

const emailMarkerItemSchema = z.object({
  entityType: z.literal(EntityType.EmailMarker),
  schemaVersion: z.number().int().positive(),
  customerId: z.string(),
});

export function customerToItem(customer: Customer, version = 1): Record<string, unknown> {
  return {
    ...customerKey(customer.customerId),
    entityType: EntityType.Customer,
    schemaVersion: SCHEMA_VERSION,
    version,
    customerId: customer.customerId,
    email: normalizeEmail(customer.email),
    name: customer.name,
    createdAt: customer.createdAt,
  };
}

/** The marker carries nothing but the id it points at. */
export function emailMarkerToItem(customer: Customer): Record<string, unknown> {
  return {
    ...emailMarkerKey(customer.email),
    entityType: EntityType.EmailMarker,
    schemaVersion: SCHEMA_VERSION,
    customerId: customer.customerId,
  };
}

export function customerFromItem(raw: unknown): Customer {
  const item = parseItem(customerItemSchema, EntityType.Customer, raw);

  return buildDomain(EntityType.Customer, raw, () => ({
    customerId: customerId(item.customerId),
    email: item.email,
    name: item.name,
    createdAt: item.createdAt,
  }));
}

/** AP6 returns the marker, and the marker's only job is to name the customer. */
export function customerIdFromEmailMarker(raw: unknown) {
  const item = parseItem(emailMarkerItemSchema, EntityType.EmailMarker, raw);

  return buildDomain(EntityType.EmailMarker, raw, () => customerId(item.customerId));
}
