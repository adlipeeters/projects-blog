/**
 * Money in integer cents (spec section 3). Never floats: 0.1 + 0.2 is not 0.3, and a cent lost per
 * order line is a cent nobody can explain later.
 *
 * Prices are snapshotted onto order lines at checkout, so an order's total stays what the customer
 * agreed to even after the catalog price changes.
 */

import { ValidationError } from '../shared/errors.js';

export type Currency = 'EUR';

export type Money = {
  readonly amountCents: number;
  readonly currency: Currency;
};

export const EUR: Currency = 'EUR';

export function money(amountCents: number, currency: Currency = EUR): Money {
  if (!Number.isSafeInteger(amountCents)) {
    throw new ValidationError('Money must be a whole number of cents', { amountCents });
  }
  if (amountCents < 0) {
    throw new ValidationError('Money cannot be negative', { amountCents });
  }
  return { amountCents, currency };
}

export const zero = (currency: Currency = EUR): Money => money(0, currency);

const sameCurrency = (a: Money, b: Money): void => {
  if (a.currency !== b.currency) {
    throw new ValidationError('Cannot mix currencies', { left: a.currency, right: b.currency });
  }
};

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountCents + b.amountCents, a.currency);
}

/** A line total: unit price times quantity. Quantity must be a positive whole number. */
export function times(unit: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new ValidationError('Quantity must be a positive whole number', { quantity });
  }
  return money(unit.amountCents * quantity, unit.currency);
}

export const sum = (amounts: readonly Money[], currency: Currency = EUR): Money =>
  amounts.reduce(add, zero(currency));

/** For logs and responses, never for arithmetic. */
export const format = (amount: Money): string =>
  `${(amount.amountCents / 100).toFixed(2)} ${amount.currency}`;
