"""Turns document text into chunks. Pure and deterministic: the same file always gives the same
chunks, which is what makes re-indexing under `{doc_id}:{chunk_index}` an overwrite."""

import re
from collections.abc import Sequence
from dataclasses import dataclass

# About 400 tokens with 15% overlap, at roughly 4 characters per token.
MAX_CHARS = 1600
OVERLAP_CHARS = 240

_HEADING = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
_FENCE = re.compile(r"^ {0,3}(```|~~~)")
_WHITESPACE = re.compile(r"\s")
_BREAKS = ("\n\n", "\n", ". ", " ")


@dataclass(frozen=True)
class Chunk:
    chunk_index: int
    text: str
    heading_path: tuple[str, ...] = ()
    page: int | None = None


def split_text(
    text: str, max_chars: int = MAX_CHARS, overlap_chars: int = OVERLAP_CHARS
) -> list[str]:
    """Split on paragraph, line, sentence or word boundaries, in that order of preference."""
    if overlap_chars >= max_chars:
        raise ValueError("overlap must be smaller than the chunk size")
    text = text.strip()
    pieces: list[str] = []
    start = 0
    while len(text) - start > max_chars:
        end = _break_point(text, start, start + max_chars)
        pieces.append(text[start:end].strip())
        start = _next_start(text, start, end, overlap_chars)
    pieces.append(text[start:].strip())
    return [piece for piece in pieces if piece]


def chunk_markdown(text: str) -> list[Chunk]:
    """One or more chunks per section. The heading goes in `heading_path`, not in the text."""
    chunks: list[Chunk] = []
    for path, body in _sections(text):
        for piece in split_text(body):
            chunks.append(Chunk(chunk_index=len(chunks), text=piece, heading_path=path))
    return chunks


def chunk_pages(pages: Sequence[str]) -> list[Chunk]:
    """One or more chunks per PDF page, so a citation can name the page."""
    chunks: list[Chunk] = []
    for number, page in enumerate(pages, start=1):
        for piece in split_text(page):
            chunks.append(Chunk(chunk_index=len(chunks), text=piece, page=number))
    return chunks


def embedding_input(title: str, chunk: Chunk) -> str:
    """The text to embed: the chunk plus where it sits, so "Eligibility" under "Parental leave"
    does not embed like "Eligibility" under "Stock options"."""
    location = " > ".join((title, *chunk.heading_path))
    return f"{location}\n\n{chunk.text}"


def _break_point(text: str, start: int, limit: int) -> int:
    # Only the second half of the window, so a break near the start can't produce a tiny chunk.
    earliest = start + (limit - start) // 2
    for separator in _BREAKS:
        at = text.rfind(separator, earliest, limit)
        if at != -1:
            return at + len(separator)
    return limit


def _next_start(text: str, start: int, end: int, overlap_chars: int) -> int:
    candidate = max(end - overlap_chars, start + 1)
    if text[candidate - 1].isspace():
        return candidate
    # Mid-word: move forward to the next word, or give up the overlap if there isn't one.
    whitespace = _WHITESPACE.search(text, candidate, end)
    return whitespace.end() if whitespace else end


def _sections(text: str) -> list[tuple[tuple[str, ...], str]]:
    sections: list[tuple[tuple[str, ...], str]] = []
    headings: list[tuple[int, str]] = []
    lines: list[str] = []
    in_fence = False

    def close_section() -> None:
        sections.append((tuple(title for _, title in headings), "\n".join(lines)))
        lines.clear()

    for line in text.splitlines():
        if _FENCE.match(line):
            in_fence = not in_fence
        heading = None if in_fence else _HEADING.match(line)
        if heading is None:
            lines.append(line)
            continue
        close_section()
        level = len(heading.group(1))
        headings = [entry for entry in headings if entry[0] < level]
        headings.append((level, heading.group(2)))
    close_section()
    return sections
