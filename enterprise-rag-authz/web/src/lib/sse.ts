export interface ServerEvent {
  name: string;
  data: unknown;
}

/** Turns stream chunks into events. A network chunk can end anywhere, even mid-event. */
export class SseParser {
  private buffer = '';

  feed(chunk: string): ServerEvent[] {
    this.buffer += chunk;
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop() ?? '';
    return blocks.flatMap((block) => {
      const event = parseBlock(block);
      return event ? [event] : [];
    });
  }
}

function parseBlock(block: string): ServerEvent | null {
  let name = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) name = line.slice('event: '.length);
    if (line.startsWith('data: ')) data += line.slice('data: '.length);
  }
  // A block with no event is the heartbeat comment.
  return name ? { name, data: data ? JSON.parse(data) : null } : null;
}
