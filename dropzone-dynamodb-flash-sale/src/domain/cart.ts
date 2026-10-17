/**
 * Carts, the one aggregate that lives in a global table.
 *
 * Each line is its own item rather than a map inside the cart, so two Regions editing different
 * lines cannot overwrite each other. A lost concurrent update on the same line is harmless: the
 * shopper sees the other version and re-adds the item (spec section 5).
 */

import type { CartId, CustomerId, Sku } from './ids.js';

export type CartLine = {
  readonly sku: Sku;
  readonly qty: number;
  readonly addedAt: string;
};

export type Cart = {
  readonly cartId: CartId;
  readonly customerId?: CustomerId;
  readonly lines: readonly CartLine[];
  readonly updatedAt: string;
  /** Which Region last wrote, useful when explaining replication lag in the article. */
  readonly lastRegion: string;
};

/** Spec section 5: last activity plus 30 days, refreshed on every write. */
export const CART_TTL_DAYS = 30;

/** TTL attributes are epoch seconds, because DynamoDB requires a Number. */
export const cartTtl = (lastActivity: Date, days = CART_TTL_DAYS): number =>
  Math.floor(lastActivity.getTime() / 1000) + days * 24 * 60 * 60;

export const MAX_CART_LINES = 20;
