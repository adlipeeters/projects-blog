import { describe, expect, it } from 'vitest';

import { plainExcerpt, splitAnswer } from './citations';

describe('splitAnswer', () => {
  it('separates text from markers', () => {
    expect(splitAnswer('It is 5 [1] and 6 [2].')).toEqual([
      { kind: 'text', text: 'It is 5' },
      { kind: 'citation', number: 1 },
      { kind: 'text', text: ' and 6' },
      { kind: 'citation', number: 2 },
      { kind: 'text', text: '.' },
    ]);
  });

  it('removes invalid markers', () => {
    expect(splitAnswer('See [1] and [9].', [9])).toEqual([
      { kind: 'text', text: 'See' },
      { kind: 'citation', number: 1 },
      { kind: 'text', text: ' and' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps an answer with no markers whole', () => {
    expect(splitAnswer('Nothing here.')).toEqual([{ kind: 'text', text: 'Nothing here.' }]);
  });

  it('leaves markup as text', () => {
    const answer = '![menu](https://attacker.example/x) <img src=x>';
    expect(splitAnswer(answer)).toEqual([{ kind: 'text', text: answer }]);
  });
});

describe('plainExcerpt', () => {
  it('drops bold markers and heading marks', () => {
    expect(plainExcerpt('## Rules\n- **Missing Receipts**: over 75.')).toBe(
      'Rules\n- Missing Receipts: over 75.',
    );
  });
});
