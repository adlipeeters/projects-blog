from collections.abc import Iterator

import boto3
import pytest
from moto import mock_aws

from erag.documents.registry import (
    Document,
    DocumentRegistry,
    StateConflictError,
    Status,
    object_key,
    parse_object_key,
)


@pytest.fixture
def registry() -> Iterator[DocumentRegistry]:
    with mock_aws():
        table = boto3.resource("dynamodb", region_name="eu-central-1").create_table(
            TableName="registry",
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
        )
        yield DocumentRegistry(table)


def document(tenant: str = "alderline", doc_id: str = "doc-1") -> Document:
    return Document(
        tenant_id=tenant,
        doc_id=doc_id,
        title="Salary Bands 2026",
        content_type="text/markdown",
        size=100,
        allowed_groups=["hr"],
        created_by="admin-1",
    )


def test_a_created_document_reads_back_pending(registry: DocumentRegistry) -> None:
    created = document()
    registry.create(created)
    assert registry.get("alderline", "doc-1") == created
    assert created.status == Status.PENDING


def test_one_company_cannot_address_another_companys_document(registry: DocumentRegistry) -> None:
    registry.create(document("alderline", "doc-1"))
    assert registry.get("brightmoor", "doc-1") is None
    assert registry.list("brightmoor") == []


def test_list_returns_only_the_tenants_documents(registry: DocumentRegistry) -> None:
    registry.create(document("alderline", "doc-1"))
    registry.create(document("alderline", "doc-2"))
    registry.create(document("brightmoor", "doc-3"))
    assert {d.doc_id for d in registry.list("alderline")} == {"doc-1", "doc-2"}


def test_transition_records_chunk_count(registry: DocumentRegistry) -> None:
    registry.create(document())
    registry.transition("alderline", "doc-1", Status.PROCESSING, {Status.PENDING})
    registry.transition("alderline", "doc-1", Status.INDEXED, {Status.PROCESSING}, chunk_count=7)
    stored = registry.get("alderline", "doc-1")
    assert stored is not None
    assert (stored.status, stored.chunk_count) == (Status.INDEXED, 7)


def test_a_disallowed_transition_conflicts(registry: DocumentRegistry) -> None:
    registry.create(document())
    with pytest.raises(StateConflictError):
        registry.transition("alderline", "doc-1", Status.INDEXED, {Status.PROCESSING})


def test_a_transition_on_a_missing_document_conflicts(registry: DocumentRegistry) -> None:
    with pytest.raises(StateConflictError):
        registry.transition("alderline", "missing", Status.DELETING, {Status.PENDING})
    assert registry.get("alderline", "missing") is None


def test_creating_the_same_document_twice_fails(registry: DocumentRegistry) -> None:
    registry.create(document())
    with pytest.raises(Exception, match="ConditionalCheckFailed"):
        registry.create(document())


def test_object_keys_round_trip_and_reject_anything_else() -> None:
    assert parse_object_key(object_key("alderline", "doc-1")) == ("alderline", "doc-1")
    for key in ["alderline", "/doc-1", "alderline/", "alderline/doc-1/extra"]:
        assert parse_object_key(key) is None
