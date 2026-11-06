from collections.abc import Iterator
from dataclasses import replace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from erag.auth.principal import Principal
from erag.documents.registry import Document, StateConflictError, Status
from erag_api.auth import InvalidTokenError, get_verifier
from erag_api.chat import get_usage
from erag_api.documents import MAX_UPLOAD_BYTES, Services, get_services
from erag_api.main import app

ADMIN = Principal("admin-1", "alderline", frozenset({"all-staff", "tenant-admin"}))
OTHER_ADMIN = Principal("admin-2", "brightmoor", frozenset({"all-staff", "tenant-admin"}))
HR = Principal("user-1", "alderline", frozenset({"all-staff", "hr"}))
TOKENS = {"admin": ADMIN, "other-admin": OTHER_ADMIN, "hr": HR}
VALID_BODY = {
    "title": "Handbook",
    "content_type": "text/markdown",
    "size": 100,
    "allowed_groups": ["hr"],
}


class FakeVerifier:
    def verify(self, token: str) -> Principal:
        if token not in TOKENS:
            raise InvalidTokenError
        return TOKENS[token]


class FakeRegistry:
    def __init__(self) -> None:
        self.documents: dict[tuple[str, str], Document] = {}

    def create(self, document: Document) -> None:
        self.documents[(document.tenant_id, document.doc_id)] = document

    def get(self, tenant_id: str, doc_id: str) -> Document | None:
        return self.documents.get((tenant_id, doc_id))

    def list(self, tenant_id: str) -> list[Document]:
        return [doc for (tenant, _), doc in self.documents.items() if tenant == tenant_id]

    def transition(
        self, tenant_id: str, doc_id: str, to: Status, allowed_from: set[Status], **_: Any
    ) -> None:
        document = self.documents.get((tenant_id, doc_id))
        if document is None or document.status not in allowed_from:
            raise StateConflictError
        self.documents[(tenant_id, doc_id)] = replace(document, status=to)

    def delete(self, tenant_id: str, doc_id: str) -> None:
        del self.documents[(tenant_id, doc_id)]


@pytest.fixture
def registry() -> FakeRegistry:
    return FakeRegistry()


@pytest.fixture
def s3() -> MagicMock:
    client = MagicMock()
    client.generate_presigned_post.return_value = {"url": "https://s3", "fields": {}}
    return client


@pytest.fixture
def delete_chunks() -> Iterator[MagicMock]:
    with patch("erag_api.documents.delete_document_chunks") as mock:
        yield mock


@pytest.fixture
def client(registry: FakeRegistry, s3: MagicMock, delete_chunks: MagicMock) -> Iterator[TestClient]:
    services = Services(registry, s3, MagicMock(), "bucket")  # type: ignore[arg-type]
    app.dependency_overrides[get_verifier] = lambda: FakeVerifier()
    app.dependency_overrides[get_services] = lambda: services
    usage = MagicMock()
    usage.remaining.return_value = {"questions_left_today": 200, "tokens_left_today": 200_000}
    app.dependency_overrides[get_usage] = lambda: usage
    yield TestClient(app)
    app.dependency_overrides.clear()


def auth(name: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {name}"}


def stored(tenant: str = "alderline", status: Status = Status.INDEXED) -> Document:
    return Document(
        tenant_id=tenant,
        doc_id="doc-1",
        title="Handbook",
        content_type="text/markdown",
        size=100,
        allowed_groups=["hr"],
        created_by="admin-1",
        status=status,
    )


def test_health_needs_no_token(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_me_reports_the_token_contents(client: TestClient) -> None:
    body = client.get("/api/me", headers=auth("admin")).json()
    assert body["tenant_id"] == "alderline"
    assert body["read_groups"] == ["all-staff"]
    assert body["questions_left_today"] == 200


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer junk"}, {"Authorization": "x"}])
def test_missing_or_bad_tokens_get_401(client: TestClient, headers: dict[str, str]) -> None:
    assert client.get("/api/admin/documents", headers=headers).status_code == 401


def test_non_admins_get_403_everywhere(client: TestClient) -> None:
    headers = auth("hr")
    assert client.get("/api/admin/documents", headers=headers).status_code == 403
    response = client.post("/api/admin/documents", headers=headers, json=VALID_BODY)
    assert response.status_code == 403
    assert client.delete("/api/admin/documents/doc-1", headers=headers).status_code == 403


def test_create_takes_the_tenant_from_the_token(
    client: TestClient, registry: FakeRegistry, s3: MagicMock
) -> None:
    body = {**VALID_BODY, "tenant_id": "brightmoor", "created_by": "someone-else"}
    response = client.post("/api/admin/documents", headers=auth("admin"), json=body)
    assert response.status_code == 201
    document = next(iter(registry.documents.values()))
    assert document.tenant_id == "alderline"
    assert document.created_by == "admin-1"
    assert document.status == Status.PENDING
    assert s3.generate_presigned_post.call_args.kwargs["Key"] == f"alderline/{document.doc_id}"


def test_the_presigned_post_limits_type_and_size(client: TestClient, s3: MagicMock) -> None:
    client.post("/api/admin/documents", headers=auth("admin"), json=VALID_BODY)
    conditions = s3.generate_presigned_post.call_args.kwargs["Conditions"]
    assert {"Content-Type": "text/markdown"} in conditions
    assert ["content-length-range", 1, MAX_UPLOAD_BYTES] in conditions


@pytest.mark.parametrize(
    "bad",
    [
        {"content_type": "text/html"},
        {"size": 0},
        {"size": MAX_UPLOAD_BYTES + 1},
        {"title": ""},
        {"allowed_groups": []},
        {"allowed_groups": ["tenant-admin"]},
        {"allowed_groups": ["hr", "made-up"]},
    ],
)
def test_invalid_uploads_are_rejected(client: TestClient, bad: dict[str, Any]) -> None:
    body = {**VALID_BODY, **bad}
    response = client.post("/api/admin/documents", headers=auth("admin"), json=body)
    assert response.status_code == 422


def test_list_shows_only_the_admins_company(client: TestClient, registry: FakeRegistry) -> None:
    registry.create(stored("alderline"))
    registry.create(replace(stored("brightmoor"), doc_id="doc-2"))
    body = client.get("/api/admin/documents", headers=auth("admin")).json()
    assert [document["doc_id"] for document in body] == ["doc-1"]


def test_delete_removes_chunks_then_object_then_record(
    client: TestClient, registry: FakeRegistry, s3: MagicMock, delete_chunks: MagicMock
) -> None:
    registry.create(stored())
    response = client.delete("/api/admin/documents/doc-1", headers=auth("admin"))
    assert response.status_code == 204
    assert delete_chunks.call_args.args[1:] == ("alderline", "doc-1")
    s3.delete_object.assert_called_once_with(Bucket="bucket", Key="alderline/doc-1")
    assert registry.documents == {}


def test_another_companys_document_looks_missing(
    client: TestClient, registry: FakeRegistry, delete_chunks: MagicMock
) -> None:
    registry.create(stored("brightmoor"))
    response = client.delete("/api/admin/documents/doc-1", headers=auth("admin"))
    assert response.status_code == 404
    delete_chunks.assert_not_called()
    assert registry.get("brightmoor", "doc-1") is not None


def test_a_processing_document_cannot_be_deleted(
    client: TestClient, registry: FakeRegistry, delete_chunks: MagicMock
) -> None:
    registry.create(stored(status=Status.PROCESSING))
    response = client.delete("/api/admin/documents/doc-1", headers=auth("admin"))
    assert response.status_code == 409
    delete_chunks.assert_not_called()


def test_a_failed_delete_can_be_resumed(
    client: TestClient, registry: FakeRegistry, delete_chunks: MagicMock
) -> None:
    registry.create(stored())
    delete_chunks.side_effect = ConnectionError
    with pytest.raises(ConnectionError):
        client.delete("/api/admin/documents/doc-1", headers=auth("admin"))
    document = registry.get("alderline", "doc-1")
    assert document is not None
    assert document.status == Status.DELETING

    delete_chunks.side_effect = None
    assert client.delete("/api/admin/documents/doc-1", headers=auth("admin")).status_code == 204
    assert registry.documents == {}
