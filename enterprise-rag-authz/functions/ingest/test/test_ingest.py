import io
import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import ingest
from erag.documents.registry import Document, StateConflictError, Status


class FakeRegistry:
    def __init__(self, document: Document | None) -> None:
        self.document = document
        self.history: list[tuple[Status, int | None, str | None]] = []

    def get(self, _tenant_id: str, _doc_id: str) -> Document | None:
        return self.document

    def transition(
        self,
        _tenant_id: str,
        _doc_id: str,
        to: Status,
        allowed_from: set[Status],
        chunk_count: int | None = None,
        error: str | None = None,
    ) -> None:
        assert self.document is not None
        if self.document.status not in allowed_from:
            raise StateConflictError
        self.document = Document(**{**self.document.__dict__, "status": to})
        self.history.append((to, chunk_count, error))


def document(
    status: Status = Status.PENDING,
    groups: tuple[str, ...] = ("hr",),
    content_type: str = "text/markdown",
) -> Document:
    return Document(
        tenant_id="alderline",
        doc_id="doc-1",
        title="Handbook",
        content_type=content_type,
        size=10,
        allowed_groups=list(groups),
        created_by="admin-1",
        status=status,
    )


def deps(registry: FakeRegistry, body: bytes = b"# Leave\n\nText.\n") -> ingest.Deps:
    s3 = MagicMock()
    s3.get_object.return_value = {"Body": io.BytesIO(body)}
    bedrock = MagicMock()
    bedrock.invoke_model.side_effect = lambda **_: {
        "body": io.BytesIO(json.dumps({"embedding": [0.1]}).encode())
    }
    return ingest.Deps(registry, s3, bedrock, MagicMock(), "bucket")  # type: ignore[arg-type]


def message(key: str = "alderline/doc-1", receives: int = 1) -> dict[str, Any]:
    return {
        "attributes": {"ApproximateReceiveCount": str(receives)},
        "body": json.dumps({"Records": [{"s3": {"object": {"key": key}}}]}),
    }


@pytest.fixture
def writes() -> Any:
    with (
        patch.object(ingest, "index_chunks") as index_chunks,
        patch.object(ingest, "delete_document_chunks") as delete_chunks,
    ):
        yield index_chunks, delete_chunks


def test_a_document_is_indexed_with_its_acl(writes: Any) -> None:
    index_chunks, _ = writes
    registry = FakeRegistry(document())
    ingest.process_message(message(), deps(registry))
    assert registry.history == [
        (Status.PROCESSING, None, None),
        (Status.INDEXED, 1, None),
    ]
    action = index_chunks.call_args.args[1][0]
    assert action["_source"]["tenant_id"] == "alderline"
    assert action["_source"]["allowed_groups"] == ["hr"]


def test_an_unregistered_object_is_deleted_and_never_indexed(writes: Any) -> None:
    index_chunks, _ = writes
    registry = FakeRegistry(None)
    dependencies = deps(registry)
    ingest.process_message(message(), dependencies)
    index_chunks.assert_not_called()
    dependencies.s3.delete_object.assert_called_once_with(Bucket="bucket", Key="alderline/doc-1")


def test_a_malformed_key_is_dropped(writes: Any) -> None:
    index_chunks, _ = writes
    dependencies = deps(FakeRegistry(document()))
    ingest.process_message(message(key="no-separator"), dependencies)
    index_chunks.assert_not_called()


@pytest.mark.parametrize("groups", [(), ("tenant-admin",), ("hr", "made-up")])
def test_a_bad_acl_fails_closed(writes: Any, groups: tuple[str, ...]) -> None:
    index_chunks, _ = writes
    registry = FakeRegistry(document(groups=groups))
    ingest.process_message(message(), deps(registry))
    index_chunks.assert_not_called()
    assert registry.history == [(Status.FAILED, None, "the document has an invalid ACL")]


@pytest.mark.parametrize("status", [Status.INDEXED, Status.DELETING])
def test_a_duplicate_event_changes_nothing(writes: Any, status: Status) -> None:
    index_chunks, _ = writes
    registry = FakeRegistry(document(status=status))
    ingest.process_message(message(), deps(registry))
    index_chunks.assert_not_called()
    assert registry.history == []


def test_an_unreadable_file_fails_without_a_retry(writes: Any) -> None:
    index_chunks, _ = writes
    registry = FakeRegistry(document(content_type="application/pdf"))
    ingest.process_message(message(), deps(registry, body=b"not a pdf"))
    index_chunks.assert_not_called()
    assert registry.history[-1] == (Status.FAILED, None, "the PDF can't be read")


def test_a_transient_error_retries_and_stays_processing(writes: Any) -> None:
    index_chunks, _ = writes
    index_chunks.side_effect = ConnectionError
    registry = FakeRegistry(document())
    with pytest.raises(ConnectionError):
        ingest.process_message(message(receives=1), deps(registry))
    assert registry.history == [(Status.PROCESSING, None, None)]


def test_a_retry_picks_up_a_document_left_processing(writes: Any) -> None:
    registry = FakeRegistry(document(status=Status.PROCESSING))
    ingest.process_message(message(receives=2), deps(registry))
    assert registry.history[-1] == (Status.INDEXED, 1, None)


def test_the_last_attempt_records_failed_and_clears_partial_chunks(writes: Any) -> None:
    index_chunks, delete_chunks = writes
    index_chunks.side_effect = ConnectionError
    registry = FakeRegistry(document())
    with pytest.raises(ConnectionError):
        ingest.process_message(message(receives=ingest.MAX_RECEIVES), deps(registry))
    assert registry.history[-1] == (Status.FAILED, None, "processing failed after retries")
    assert delete_chunks.call_count == 2


def test_the_s3_test_event_is_ignored(writes: Any) -> None:
    index_chunks, _ = writes
    event = {"attributes": {}, "body": json.dumps({"Event": "s3:TestEvent"})}
    ingest.process_message(event, deps(FakeRegistry(None)))
    index_chunks.assert_not_called()
