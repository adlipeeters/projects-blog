import pytest

from erag.documents.registry import Document
from erag.ingest.chunker import Chunk
from erag.retrieval.chunks import chunk_actions, document_query
from erag.retrieval.index import CHUNKS_INDEX

DOCUMENT = Document(
    tenant_id="alderline",
    doc_id="doc-1",
    title="Handbook",
    content_type="text/markdown",
    size=10,
    allowed_groups=["all-staff", "hr"],
    created_by="admin-1",
)


def test_every_chunk_carries_the_acl_and_a_deterministic_id() -> None:
    chunks = [Chunk(0, "One.", ("Leave", "Sick")), Chunk(1, "Two.", page=3)]
    first, second = chunk_actions(DOCUMENT, chunks, [[0.1], [0.2]])
    assert first["_index"] == CHUNKS_INDEX
    assert (first["_id"], second["_id"]) == ("doc-1:0", "doc-1:1")
    for action in (first, second):
        assert action["_source"]["tenant_id"] == "alderline"
        assert action["_source"]["allowed_groups"] == ["all-staff", "hr"]
    assert first["_source"]["heading_path"] == "Leave > Sick"
    assert second["_source"]["page"] == 3


def test_one_vector_per_chunk() -> None:
    with pytest.raises(ValueError):
        chunk_actions(DOCUMENT, [Chunk(0, "One.")], [])


def test_a_document_query_is_scoped_to_the_tenant() -> None:
    assert document_query("alderline", "doc-1")["bool"]["filter"] == [
        {"term": {"tenant_id": "alderline"}},
        {"term": {"doc_id": "doc-1"}},
    ]
