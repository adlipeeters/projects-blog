/**
 * Every item carries `entityType` (spec section 3), and the values are a closed set because the
 * stream filters in spec section 12 match on them. A typo here means a stream consumer silently
 * stops seeing records.
 */

export const EntityType = {
  Product: 'Product',
  Variant: 'Variant',
  SkuPointer: 'SkuPointer',
  Customer: 'Customer',
  EmailMarker: 'EmailMarker',
  Order: 'Order',
  OrderLine: 'OrderLine',
  StockBucket: 'StockBucket',
  Hold: 'Hold',
  IdempotencyKey: 'IdempotencyKey',
  SalesAggregate: 'SalesAggregate',
  NotificationMarker: 'NotificationMarker',
  BackfillCheckpoint: 'BackfillCheckpoint',
  Cart: 'Cart',
  CartLine: 'CartLine',
} as const;

export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/** Items start at schema version 1 and only move when a mapper learns to read an older shape. */
export const SCHEMA_VERSION = 1;
