"""Turns an uploaded file into chunks. An unreadable file is a permanent error: retrying it won't
change the bytes."""

import io

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from erag.ingest.chunker import Chunk, chunk_markdown, chunk_pages

MARKDOWN = "text/markdown"
PDF = "application/pdf"


class UnreadableDocumentError(Exception):
    """The file can't be turned into text. The message is safe to show an admin."""


def parse_document(data: bytes, content_type: str) -> list[Chunk]:
    if content_type == MARKDOWN:
        chunks = chunk_markdown(_decode(data))
    elif content_type == PDF:
        chunks = chunk_pages(_pdf_pages(data))
    else:
        raise UnreadableDocumentError(f"unsupported type: {content_type}")
    if not chunks:
        raise UnreadableDocumentError("the file contains no text")
    return chunks


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise UnreadableDocumentError("the file is not valid UTF-8") from error


def _pdf_pages(data: bytes) -> list[str]:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise UnreadableDocumentError("the PDF is encrypted")
        return [page.extract_text() or "" for page in reader.pages]
    except (PyPdfError, ValueError, KeyError, TypeError, OSError) as error:
        raise UnreadableDocumentError("the PDF can't be read") from error
