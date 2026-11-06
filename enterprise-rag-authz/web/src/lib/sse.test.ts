import { describe, expect, it } from 'vitest';

import { SseParser } from './sse';

describe('SseParser', () => {
  it('reads a whole event', () => {
    const events = new SseParser().feed('event: token\ndata: {"text":"hi"}\n\n');
    expect(events).toEqual([{ name: 'token', data: { text: 'hi' } }]);
  });

  it('reads several events from one chunk', () => {
    const events = new SseParser().feed(
      'event: token\ndata: {"text":"a"}\n\nevent: done\ndata: {}\n\n',
    );
    expect(events.map((event) => event.name)).toEqual(['token', 'done']);
  });

  it('holds a partial event until the rest arrives', () => {
    const parser = new SseParser();
    expect(parser.feed('event: token\ndata: {"te')).toEqual([]);
    expect(parser.feed('xt":"hi"}\n')).toEqual([]);
    expect(parser.feed('\n')).toEqual([{ name: 'token', data: { text: 'hi' } }]);
  });

  it('ignores heartbeat comments', () => {
    const events = new SseParser().feed(': keepalive\n\nevent: done\ndata: {}\n\n');
    expect(events).toEqual([{ name: 'done', data: {} }]);
  });
});
