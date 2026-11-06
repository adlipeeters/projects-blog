"""S3 to SQS to this Lambda (spec section 7). Fails closed: a file with no registry record, or a
record with a bad ACL, is never indexed."""

import contextlib
import json
import logging
import os
from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Any
from urllib.parse import unquote_plus

import boto3

from document_parser import UnreadableDocumentError, parse_document
from erag.authz import validate_allowed_groups
from erag.documents.registry import (
    Document,
    DocumentRegistry,
    StateConflictError,
    Status,
    parse_object_key,
)
from erag.embeddings import embed_text
from erag.ingest.chunker import embedding_input
from erag.retrieval.chunks import chunk_actions, delete_document_chunks, index_chunks
from erag.retrieval.client import make_client

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Must match maxReceiveCount on the queue: the last attempt records FAILED before the DLQ takes it.
MAX_RECEIVES = 3


@dataclass(frozen=True)
class Deps:
    registry: DocumentRegistry
    s3: Any
    bedrock_runtime: Any
    search: Any
    bucket: str


def handler(event: dict[str, Any], _context: object) -> None:
    for message in event["Records"]:
        process_message(message, _deps())


def process_message(message: dict[str, Any], deps: Deps) -> None:
    body = json.loads(message["body"])
    if body.get("Event") == "s3:TestEvent":
        return
    receives = int(message["attributes"]["ApproximateReceiveCount"])
    for record in body.get("Records", []):
        key = unquote_plus(record["s3"]["object"]["key"])
        process_object(key, receives, deps)


def process_object(key: str, receives: int, deps: Deps) -> None:
    parsed = parse_object_key(key)
    document = deps.registry.get(*parsed) if parsed else None
    if document is None:
        # Nothing says who may read this file, so it can't be indexed and has no reason to exist.
        deps.s3.delete_object(Bucket=deps.bucket, Key=key)
        _log("dropped_unregistered_object", key=key)
        return
    if document.status in {Status.INDEXED, Status.DELETING}:
        _log("skipped", doc_id=document.doc_id, status=document.status.value)
        return

    try:
        groups = validate_allowed_groups(document.allowed_groups)
    except ValueError:
        _mark_failed(document, "the document has an invalid ACL", deps)
        return

    allowed = {Status.PENDING, Status.FAILED, Status.PROCESSING}
    try:
        deps.registry.transition(
            document.tenant_id, document.doc_id, Status.PROCESSING, allowed_from=allowed
        )
        count = _index(replace(document, allowed_groups=groups), key, deps)
        deps.registry.transition(
            document.tenant_id,
            document.doc_id,
            Status.INDEXED,
            allowed_from={Status.PROCESSING},
            chunk_count=count,
        )
        _log("indexed", doc_id=document.doc_id, chunks=count)
    except StateConflictError:
        _log("state_conflict", doc_id=document.doc_id)
    except UnreadableDocumentError as error:
        _mark_failed(document, str(error), deps)
    except Exception:
        _log("attempt_failed", doc_id=document.doc_id, receives=receives)
        if receives >= MAX_RECEIVES:
            delete_document_chunks(deps.search, document.tenant_id, document.doc_id)
            _mark_failed(document, "processing failed after retries", deps)
        raise


def _index(document: Document, key: str, deps: Deps) -> int:
    data = deps.s3.get_object(Bucket=deps.bucket, Key=key)["Body"].read()
    chunks = parse_document(data, document.content_type)
    vectors = [
        embed_text(deps.bedrock_runtime, embedding_input(document.title, chunk)) for chunk in chunks
    ]
    # Clears a partial write from an earlier attempt before writing the whole document.
    delete_document_chunks(deps.search, document.tenant_id, document.doc_id)
    index_chunks(deps.search, chunk_actions(document, chunks, vectors))
    return len(chunks)


def _mark_failed(document: Document, reason: str, deps: Deps) -> None:
    with contextlib.suppress(StateConflictError):
        deps.registry.transition(
            document.tenant_id,
            document.doc_id,
            Status.FAILED,
            allowed_from={Status.PENDING, Status.PROCESSING, Status.FAILED},
            error=reason,
        )
    _log("failed", doc_id=document.doc_id, reason=reason)


def _log(event: str, **fields: object) -> None:
    # IDs and states only. Document text never goes in a log.
    logger.info(json.dumps({"event": event, **fields}))


@lru_cache(maxsize=1)
def _deps() -> Deps:
    region = os.environ["AWS_REGION"]
    return Deps(
        registry=DocumentRegistry(boto3.resource("dynamodb").Table(os.environ["REGISTRY_TABLE"])),
        s3=boto3.client("s3"),
        bedrock_runtime=boto3.client("bedrock-runtime"),
        search=make_client(os.environ["SEARCH_ENDPOINT"], region),
        bucket=os.environ["DOCUMENTS_BUCKET"],
    )
