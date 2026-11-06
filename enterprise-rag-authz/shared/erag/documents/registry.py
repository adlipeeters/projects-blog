"""The document registry in DynamoDB: what each company has, who may read it, and where it is in
the pipeline. The tenant is part of the key, so a request can only address its own company."""

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError


class Status(StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    INDEXED = "INDEXED"
    FAILED = "FAILED"
    DELETING = "DELETING"


class StateConflictError(Exception):
    """The document was not in a state that allows this change."""


@dataclass(frozen=True)
class Document:
    tenant_id: str
    doc_id: str
    title: str
    content_type: str
    size: int
    allowed_groups: list[str]
    created_by: str
    status: Status = Status.PENDING
    chunk_count: int = 0
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


def object_key(tenant_id: str, doc_id: str) -> str:
    """No user-supplied filename goes in the key."""
    return f"{tenant_id}/{doc_id}"


def parse_object_key(key: str) -> tuple[str, str] | None:
    tenant_id, separator, doc_id = key.partition("/")
    if not separator or not tenant_id or not doc_id or "/" in doc_id:
        return None
    return tenant_id, doc_id


class DocumentRegistry:
    def __init__(self, table: Any) -> None:
        self._table = table

    def create(self, document: Document) -> None:
        self._table.put_item(
            Item={**_key(document.tenant_id, document.doc_id), **asdict(document)},
            ConditionExpression=Attr("PK").not_exists(),
        )

    def get(self, tenant_id: str, doc_id: str) -> Document | None:
        item = self._table.get_item(Key=_key(tenant_id, doc_id), ConsistentRead=True).get("Item")
        return _document(item) if item else None

    def list(self, tenant_id: str) -> list[Document]:
        condition = Key("PK").eq(f"TENANT#{tenant_id}") & Key("SK").begins_with("DOC#")
        items: list[dict[str, Any]] = []
        kwargs: dict[str, Any] = {"KeyConditionExpression": condition, "ConsistentRead": True}
        while True:
            page = self._table.query(**kwargs)
            items.extend(page["Items"])
            if "LastEvaluatedKey" not in page:
                return [_document(item) for item in items]
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def transition(
        self,
        tenant_id: str,
        doc_id: str,
        to: Status,
        allowed_from: set[Status],
        chunk_count: int | None = None,
        error: str | None = None,
    ) -> None:
        """Move to a new state only if the current one allows it."""
        update = "SET #status = :to, #error = :error"
        values: dict[str, Any] = {":to": to.value, ":error": error}
        if chunk_count is not None:
            update += ", chunk_count = :chunk_count"
            values[":chunk_count"] = chunk_count
        try:
            self._table.update_item(
                Key=_key(tenant_id, doc_id),
                UpdateExpression=update,
                ConditionExpression=Attr("status").is_in([state.value for state in allowed_from]),
                ExpressionAttributeNames={"#status": "status", "#error": "error"},
                ExpressionAttributeValues=values,
            )
        except ClientError as error_response:
            if error_response.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise StateConflictError from error_response
            raise

    def delete(self, tenant_id: str, doc_id: str) -> None:
        self._table.delete_item(Key=_key(tenant_id, doc_id))


def _key(tenant_id: str, doc_id: str) -> dict[str, str]:
    return {"PK": f"TENANT#{tenant_id}", "SK": f"DOC#{doc_id}"}


def _document(item: dict[str, Any]) -> Document:
    return Document(
        tenant_id=item["tenant_id"],
        doc_id=item["doc_id"],
        title=item["title"],
        content_type=item["content_type"],
        size=int(item["size"]),
        allowed_groups=list(item["allowed_groups"]),
        created_by=item["created_by"],
        status=Status(item["status"]),
        chunk_count=int(item["chunk_count"]),
        error=item.get("error"),
        created_at=item["created_at"],
    )
