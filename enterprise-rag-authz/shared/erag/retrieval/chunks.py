"""Writes and deletes against the chunks index. Queries live in hybrid.py."""

from collections.abc import Sequence
from typing import Any

from opensearchpy import OpenSearch, helpers

from erag.documents.registry import Document
from erag.ingest.chunker import Chunk
from erag.retrieval.index import CHUNKS_INDEX


def document_query(tenant_id: str, doc_id: str) -> dict[str, Any]:
    return {
        "bool": {
            "filter": [
                {"term": {"tenant_id": tenant_id}},
                {"term": {"doc_id": doc_id}},
            ]
        }
    }


def chunk_actions(
    document: Document, chunks: Sequence[Chunk], vectors: Sequence[Sequence[float]]
) -> list[dict[str, Any]]:
    """Every chunk carries the ACL. The ID is deterministic, so re-indexing overwrites."""
    if len(chunks) != len(vectors):
        raise ValueError("one vector per chunk")
    return [
        {
            "_index": CHUNKS_INDEX,
            "_id": f"{document.doc_id}:{chunk.chunk_index}",
            "_source": {
                "tenant_id": document.tenant_id,
                "doc_id": document.doc_id,
                "allowed_groups": document.allowed_groups,
                "title": document.title,
                "heading_path": " > ".join(chunk.heading_path),
                "text": chunk.text,
                "page": chunk.page,
                "chunk_index": chunk.chunk_index,
                "embedding": list(vector),
            },
        }
        for chunk, vector in zip(chunks, vectors, strict=True)
    ]


def index_chunks(client: OpenSearch, actions: list[dict[str, Any]]) -> None:
    # wait_for: a document marked INDEXED afterwards is searchable. Errors raise, so a partial
    # write is retried instead of being reported as done.
    helpers.bulk(client, actions, refresh="wait_for")


def delete_document_chunks(client: OpenSearch, tenant_id: str, doc_id: str) -> None:
    client.delete_by_query(
        index=CHUNKS_INDEX,
        body={"query": document_query(tenant_id, doc_id)},
        params={"refresh": "true", "conflicts": "proceed"},
    )


def count_document_chunks(client: OpenSearch, tenant_id: str, doc_id: str) -> int:
    client.indices.refresh(index=CHUNKS_INDEX)
    response = client.count(index=CHUNKS_INDEX, body={"query": document_query(tenant_id, doc_id)})
    return int(response["count"])
