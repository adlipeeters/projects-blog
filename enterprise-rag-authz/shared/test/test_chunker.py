import pytest

from erag.ingest.chunker import (
    MAX_CHARS,
    Chunk,
    chunk_markdown,
    chunk_pages,
    embedding_input,
    split_text,
)

LONG_TEXT = " ".join(f"word{i}" for i in range(2000))


def test_short_text_stays_whole() -> None:
    assert split_text("  one short paragraph.  ") == ["one short paragraph."]


@pytest.mark.parametrize("text", ["", "   \n\n  "])
def test_empty_text_gives_no_chunks(text: str) -> None:
    assert split_text(text) == []


def test_long_text_stays_within_the_limit_and_loses_nothing() -> None:
    pieces = split_text(LONG_TEXT)
    assert len(pieces) > 1
    assert all(len(piece) <= MAX_CHARS for piece in pieces)
    words = {word for piece in pieces for word in piece.split()}
    assert words == set(LONG_TEXT.split())


def test_neighbouring_pieces_overlap() -> None:
    first, second = split_text(LONG_TEXT)[:2]
    assert set(first.split()) & set(second.split())


def test_pieces_never_start_or_end_mid_word() -> None:
    words = set(LONG_TEXT.split())
    for piece in split_text(LONG_TEXT):
        assert set(piece.split()) <= words


def test_prefers_a_paragraph_break() -> None:
    text = "a" * 1000 + "\n\n" + "b" * 1000
    assert split_text(text) == ["a" * 1000, "b" * 1000]


def test_a_single_long_word_is_cut_and_still_finishes() -> None:
    pieces = split_text("x" * 4000)
    assert "".join(pieces) == "x" * 4000
    assert all(len(piece) <= MAX_CHARS for piece in pieces)


def test_splitting_is_deterministic() -> None:
    assert split_text(LONG_TEXT) == split_text(LONG_TEXT)


def test_overlap_must_be_smaller_than_the_chunk() -> None:
    with pytest.raises(ValueError):
        split_text("text", max_chars=10, overlap_chars=10)


def test_markdown_keeps_the_heading_path() -> None:
    chunks = chunk_markdown(
        "Intro.\n\n# Leave\n\nLeave text.\n\n## Parental\n\nParental text.\n\n"
        "## Sick\n\nSick text.\n\n# Pay\n\nPay text.\n"
    )
    assert chunks == [
        Chunk(0, "Intro."),
        Chunk(1, "Leave text.", ("Leave",)),
        Chunk(2, "Parental text.", ("Leave", "Parental")),
        Chunk(3, "Sick text.", ("Leave", "Sick")),
        Chunk(4, "Pay text.", ("Pay",)),
    ]


def test_a_skipped_heading_level_keeps_the_parents() -> None:
    chunks = chunk_markdown("# A\n\n### B\n\nText.\n\n## C\n\nMore.\n")
    assert [chunk.heading_path for chunk in chunks] == [("A", "B"), ("A", "C")]


def test_a_heading_with_no_body_gives_no_chunk() -> None:
    assert [c.text for c in chunk_markdown("# Empty\n\n# Full\n\nText.\n")] == ["Text."]


def test_a_hash_inside_a_code_fence_is_not_a_heading() -> None:
    chunks = chunk_markdown("# Setup\n\n```bash\n# install\nmake install\n```\n")
    assert len(chunks) == 1
    assert chunks[0].heading_path == ("Setup",)
    assert "# install" in chunks[0].text


def test_chunk_indexes_run_across_sections() -> None:
    chunks = chunk_markdown(f"# A\n\n{LONG_TEXT}\n\n# B\n\nText.\n")
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))


def test_pages_are_numbered_from_one_and_blank_pages_skipped() -> None:
    assert chunk_pages(["First.", "   ", "Third."]) == [
        Chunk(0, "First.", page=1),
        Chunk(1, "Third.", page=3),
    ]


def test_embedding_input_carries_the_location() -> None:
    chunk = Chunk(0, "Text.", ("Leave", "Parental"))
    assert embedding_input("Handbook", chunk) == "Handbook > Leave > Parental\n\nText."
