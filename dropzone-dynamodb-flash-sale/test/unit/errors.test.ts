import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  CorruptItemError,
  HoldExpiredError,
  IdempotencyMismatchError,
  InvalidTransitionError,
  NotFoundError,
  SoldOutError,
  ValidationError,
  isAppError,
  toErrorResponse,
} from '../../src/shared/errors.js';

describe('error to response mapping (spec section 7)', () => {
  it('maps each client error to its documented status', () => {
    const cases = [
      [new ValidationError('body is not valid'), 400, 'VALIDATION_FAILED'],
      [new NotFoundError('no such product'), 404, 'NOT_FOUND'],
      [new SoldOutError('TEE-M-BLK'), 409, 'SOLD_OUT'],
      [new ConflictError('version moved'), 409, 'CONFLICT'],
      [new InvalidTransitionError('DELIVERED', 'PICKING'), 409, 'INVALID_TRANSITION'],
      [new HoldExpiredError('01J0HOLD'), 410, 'HOLD_EXPIRED'],
      [new IdempotencyMismatchError('same key, different body'), 422, 'IDEMPOTENCY_MISMATCH'],
    ] as const;

    for (const [error, status, code] of cases) {
      const response = toErrorResponse(error);
      expect(response.status, code).toBe(status);
      expect(response.body.code).toBe(code);
    }
  });

  it('returns the client error message and its details', () => {
    const { body } = toErrorResponse(new SoldOutError('TEE-M-BLK'));

    expect(body).toEqual({
      code: 'SOLD_OUT',
      message: 'The requested item is sold out',
      sku: 'TEE-M-BLK',
    });
  });

  it('never leaks a server error message, which carries the item key', () => {
    const error = new CorruptItemError('Order', { PK: 'CUSTOMER#01J0CUST' }, 'status: invalid');

    expect(error.message).toContain('01J0CUST');

    const { status, body } = toErrorResponse(error);
    expect(status).toBe(500);
    expect(body).toEqual({ code: 'CORRUPT_ITEM', message: 'Internal error' });
  });

  it('turns an unknown throwable into a flat 500', () => {
    for (const thrown of [new TypeError('cannot read property'), 'a string', undefined]) {
      expect(toErrorResponse(thrown)).toEqual({
        status: 500,
        body: { code: 'INTERNAL', message: 'Internal error' },
      });
    }
  });

  it('keeps the subclass name for log lines', () => {
    const error = new NotFoundError('no such order');

    expect(error.name).toBe('NotFoundError');
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});
