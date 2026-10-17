/**
 * Branded ids.
 *
 * A `string` parameter accepts any string, so `getOrder(customerId, orderId)` called with the
 * arguments swapped compiles and then queries a partition that does not exist. Branding makes that
 * a type error, and the brand is erased at runtime: an OrderId is a plain string in DynamoDB.
 *
 * Order, hold and customer ids are ULIDs (spec section 3), so they sort by creation time. That is
 * what makes `ORDER#<orderId>` sort newest-last inside a customer partition, and why AP8 only needs
 * ScanIndexForward=false rather than a timestamp in the key.
 */

import { monotonicFactory } from 'ulid';

import { ValidationError } from '../shared/errors.js';

declare const brand: unique symbol;

type Branded<T, B extends string> = T & { readonly [brand]: B };

export type CustomerId = Branded<string, 'CustomerId'>;
export type OrderId = Branded<string, 'OrderId'>;
export type HoldId = Branded<string, 'HoldId'>;
export type CartId = Branded<string, 'CartId'>;
export type ProductId = Branded<string, 'ProductId'>;
export type Sku = Branded<string, 'Sku'>;
export type CategoryId = Branded<string, 'CategoryId'>;

/** Crockford base32, 26 characters, first character at most 7 so the timestamp cannot overflow. */
const ULID_PATTERN = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/;

/** Uppercase letters, digits and dashes. Skus come from the catalog, not from a request body. */
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

/** Lowercase slug, so a category id is safe inside a key and inside a URL. */
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

const parseWith = <T extends string>(
  pattern: RegExp,
  kind: string,
  raw: string,
  hint: string,
): T => {
  if (!pattern.test(raw)) {
    throw new ValidationError(`Not a valid ${kind}: expected ${hint}`, { kind });
  }
  return raw as T;
};

/**
 * Monotonic, not the plain generator.
 *
 * `ulid()` fills the low 80 bits with randomness, so two ids minted in the same millisecond sort
 * in random order. The monotonic factory increments instead, which keeps `ORDER#<orderId>` in
 * creation order inside a customer partition even during a burst. Across containers, ids minted in
 * the same millisecond can still interleave; the ordering guarantee is per process, and AP8 only
 * needs it to be stable once written.
 */
const nextUlid = monotonicFactory();

export const newCustomerId = (): CustomerId => nextUlid() as CustomerId;
export const newOrderId = (): OrderId => nextUlid() as OrderId;
export const newHoldId = (): HoldId => nextUlid() as HoldId;
export const newCartId = (): CartId => nextUlid() as CartId;
export const newProductId = (): ProductId => nextUlid() as ProductId;

// Parsing ids that arrived from outside: a request, a header, or an item read back from DynamoDB.
export const customerId = (raw: string): CustomerId =>
  parseWith(ULID_PATTERN, 'customer id', raw, 'a ULID');
export const orderId = (raw: string): OrderId => parseWith(ULID_PATTERN, 'order id', raw, 'a ULID');
export const holdId = (raw: string): HoldId => parseWith(ULID_PATTERN, 'hold id', raw, 'a ULID');
export const cartId = (raw: string): CartId => parseWith(ULID_PATTERN, 'cart id', raw, 'a ULID');
export const productId = (raw: string): ProductId =>
  parseWith(ULID_PATTERN, 'product id', raw, 'a ULID');
export const sku = (raw: string): Sku =>
  parseWith(SKU_PATTERN, 'sku', raw, 'uppercase letters, digits and dashes');
export const categoryId = (raw: string): CategoryId =>
  parseWith(CATEGORY_PATTERN, 'category id', raw, 'a lowercase slug');

/**
 * Emails are lowercased before they become part of a key, because `EMAIL#Ada@example.com` and
 * `EMAIL#ada@example.com` are two different partitions and the uniqueness check in AP5 would miss.
 */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();
