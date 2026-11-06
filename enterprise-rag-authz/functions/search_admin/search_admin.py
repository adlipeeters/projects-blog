"""Index setup and the M1 smoke test. The domain has no route from a laptop, so this runs as a
Lambda inside the VPC. It never touches the real index's documents."""

import os
from collections.abc import Sequence
from typing import Any

from opensearchpy import OpenSearch

from erag.auth.principal import Principal
from erag.retrieval.chunks import count_document_chunks
from erag.retrieval.client import make_client
from erag.retrieval.hybrid import build_hybrid_query
from erag.retrieval.index import (
    CHUNKS_INDEX,
    EMBEDDING_DIMENSIONS,
    HYBRID_PIPELINE,
    index_body,
    pipeline_body,
)

SMOKE_INDEX = "chunks-smoke"

# (id, tenant, groups, text). Each document's vector is a unit vector along its own axis, so a
# question can point straight at one document without an embedding model.
SMOKE_DOCS = (
    ("alderline-hr", "alderline", ["hr"], "salary bands zephyrword"),
    ("alderline-finance", "alderline", ["finance"], "budget forecast"),
    ("alderline-all", "alderline", ["all-staff"], "holiday policy"),
    ("brightmoor-hr", "brightmoor", ["hr"], "salary bands quokkaword"),
)


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    client = make_client(os.environ["SEARCH_ENDPOINT"], os.environ["AWS_REGION"])
    action = event.get("action")
    if action == "setup":
        return setup(client)
    if action == "smoke":
        return smoke(client)
    if action == "count":
        # The deployed tests' only view into the index, so they can prove a delete removed chunks.
        count = count_document_chunks(client, event["tenant_id"], event["doc_id"])
        return {"ok": True, "count": count}
    raise ValueError(f"unknown action: {action}")


def setup(client: OpenSearch) -> dict[str, Any]:
    """Safe to run again: the pipeline is overwritten, and an existing index is left alone."""
    _put_pipeline(client)
    created = not client.indices.exists(index=CHUNKS_INDEX)
    if created:
        client.indices.create(index=CHUNKS_INDEX, body=index_body())
    return {"ok": True, "version": _version(client), "index_created": created}


def smoke(client: OpenSearch) -> dict[str, Any]:
    _put_pipeline(client)
    if client.indices.exists(index=SMOKE_INDEX):
        client.indices.delete(index=SMOKE_INDEX)
    client.indices.create(index=SMOKE_INDEX, body=index_body())
    try:
        for axis, (doc_id, tenant, groups, text) in enumerate(SMOKE_DOCS):
            client.index(
                index=SMOKE_INDEX,
                id=doc_id,
                body={
                    "tenant_id": tenant,
                    "doc_id": doc_id,
                    "allowed_groups": groups,
                    "text": text,
                    "embedding": _axis(axis),
                },
            )
        client.indices.refresh(index=SMOKE_INDEX)
        checks = _run_checks(client)
    finally:
        client.indices.delete(index=SMOKE_INDEX)
    return {"ok": all(check["passed"] for check in checks), "checks": checks}


def _run_checks(client: OpenSearch) -> list[dict[str, Any]]:
    hr = Principal("smoke", "alderline", frozenset({"hr", "all-staff"}))
    other_hr = Principal("smoke", "brightmoor", frozenset({"hr"}))
    no_match = "nothingmatchesthisword"

    def hits(principal: Principal, question: str, axis: int) -> set[str]:
        return _search(client, build_hybrid_query(principal, question, _axis(axis)))

    # Only the keyword subquery can reach the other company's document.
    keyword_leak = hits(hr, "quokkaword", axis=0)
    # Only the vector subquery can reach it: the question points straight at its axis.
    vector_leak = hits(hr, no_match, axis=3)
    unfiltered_query = build_hybrid_query(hr, "quokkaword", _axis(3))
    del unfiltered_query["query"]["hybrid"]["filter"]

    return [
        _check("hr sees exactly their own documents", hits(hr, "salary", 0), _HR_DOCS),
        _check("filter covers the keyword subquery", keyword_leak, _HR_DOCS),
        _check("filter covers the vector subquery", vector_leak, _HR_DOCS),
        _check("another group's document stays out", hits(hr, "budget forecast", 1), _HR_DOCS),
        _check(
            "the other company sees its own only", hits(other_hr, "salary", 3), {"brightmoor-hr"}
        ),
        # The control: the same search without a filter does find it, so the checks above can fail.
        _check(
            "without the filter the foreign document appears",
            _search(client, unfiltered_query) & {"brightmoor-hr"},
            {"brightmoor-hr"},
        ),
    ]


_HR_DOCS = {"alderline-hr", "alderline-all"}


def _check(name: str, got: set[str], expected: set[str]) -> dict[str, Any]:
    return {"name": name, "passed": got == expected, "got": sorted(got)}


def _search(client: OpenSearch, body: dict[str, Any]) -> set[str]:
    response = client.search(
        index=SMOKE_INDEX, body=body, params={"search_pipeline": HYBRID_PIPELINE}
    )
    return {hit["_id"] for hit in response["hits"]["hits"]}


def _put_pipeline(client: OpenSearch) -> None:
    client.transport.perform_request(
        "PUT", f"/_search/pipeline/{HYBRID_PIPELINE}", body=pipeline_body()
    )


def _version(client: OpenSearch) -> str:
    return str(client.info()["version"]["number"])


def _axis(axis: int) -> Sequence[float]:
    vector = [0.0] * EMBEDDING_DIMENSIONS
    vector[axis] = 1.0
    return vector
