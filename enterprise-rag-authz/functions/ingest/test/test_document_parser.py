import io

import pytest
from pypdf import PdfWriter

from document_parser import MARKDOWN, PDF, UnreadableDocumentError, parse_document


def test_markdown_keeps_headings() -> None:
    chunks = parse_document(b"# Leave\n\nText.\n", MARKDOWN)
    assert [(c.heading_path, c.text) for c in chunks] == [(("Leave",), "Text.")]


def test_invalid_utf8_is_unreadable() -> None:
    with pytest.raises(UnreadableDocumentError):
        parse_document(b"\xff\xfe\xfa", MARKDOWN)


@pytest.mark.parametrize("content_type", [MARKDOWN, PDF])
def test_empty_or_junk_files_are_unreadable(content_type: str) -> None:
    with pytest.raises(UnreadableDocumentError):
        parse_document(b"   " if content_type == MARKDOWN else b"not a pdf", content_type)


def test_a_pdf_with_no_text_is_unreadable() -> None:
    writer = PdfWriter()
    writer.add_blank_page(200, 200)
    buffer = io.BytesIO()
    writer.write(buffer)
    with pytest.raises(UnreadableDocumentError, match="no text"):
        parse_document(buffer.getvalue(), PDF)


def test_an_encrypted_pdf_is_unreadable() -> None:
    writer = PdfWriter()
    writer.add_blank_page(200, 200)
    writer.encrypt("secret")
    buffer = io.BytesIO()
    writer.write(buffer)
    with pytest.raises(UnreadableDocumentError, match="encrypted"):
        parse_document(buffer.getvalue(), PDF)


def test_an_unsupported_type_is_unreadable() -> None:
    with pytest.raises(UnreadableDocumentError, match="unsupported"):
        parse_document(b"hello", "text/html")
