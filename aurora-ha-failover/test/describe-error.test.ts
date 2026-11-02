import { describe, expect, it } from 'vitest';
import { describeError } from '../src/shared/introspect.js';

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe('describeError', () => {
  it('keeps a SQLSTATE or Node error code as it is', () => {
    expect(
      describeError(withCode('cannot execute INSERT in a read-only transaction', '25006')).code,
    ).toBe('25006');
    expect(describeError(withCode('read ECONNRESET', 'ECONNRESET')).code).toBe('ECONNRESET');
  });

  it("names pg's uncoded errors from their message", () => {
    expect(describeError(new Error('Query read timeout')).code).toBe('query_timeout');
    expect(describeError(new Error('timeout exceeded when trying to connect')).code).toBe(
      'connect_timeout',
    );
    expect(describeError(new Error('Connection terminated due to connection timeout')).code).toBe(
      'connect_timeout',
    );
    expect(describeError(new Error('Connection terminated unexpectedly')).code).toBe(
      'connection_terminated',
    );
  });

  it('falls back to the error name and keeps the message', () => {
    expect(describeError(new TypeError('something new'))).toEqual({
      code: 'TypeError',
      message: 'something new',
    });
  });
});
