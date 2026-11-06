export type AnswerPart = { kind: 'text'; text: string } | { kind: 'citation'; number: number };

/**
 * Splits an answer into text and citation markers. The result renders as plain text and chips: no
 * HTML, no images and no auto-linked URLs, so injected markup in an answer stays inert.
 */
export function splitAnswer(answer: string, invalid: number[] = []): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let position = 0;
  for (const match of answer.matchAll(/\s?\[(\d+)\]/g)) {
    const number = Number(match[1]);
    if (match.index > position) {
      parts.push({ kind: 'text', text: answer.slice(position, match.index) });
    }
    if (!invalid.includes(number)) parts.push({ kind: 'citation', number });
    position = match.index + match[0].length;
  }
  if (position < answer.length) parts.push({ kind: 'text', text: answer.slice(position) });
  return parts;
}

/** Excerpts come from Markdown files and render as plain text, so the markers would show. */
export function plainExcerpt(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '');
}
