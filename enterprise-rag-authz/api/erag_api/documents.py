"""Admin routes for one company's documents (spec sections 7 and 9). The API is what enforces
admin access: hiding the page in the browser is only UX."""

import uuid
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Annotated, Any, Literal

import boto3
from botocore.config import Config
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator

from erag.auth.principal import Principal
from erag.authz import validate_allowed_groups
from erag.documents.registry import (
    Document,
    DocumentRegistry,
    StateConflictError,
    Status,
    object_key,
)
from erag.retrieval.chunks import delete_document_chunks
from erag.retrieval.client import make_client
from erag_api.audit import audit
from erag_api.auth import require_admin
from erag_api.settings import get_settings

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
UPLOAD_EXPIRES_SECONDS = 300

router = APIRouter(prefix="/api/admin/documents")


class CreateDocument(BaseModel):
    """No tenant field: the tenant comes from the token, and extra fields are ignored."""

    title: str = Field(min_length=1, max_length=200)
    content_type: Literal["text/markdown", "application/pdf"]
    size: int = Field(gt=0, le=MAX_UPLOAD_BYTES)
    allowed_groups: list[str]

    @field_validator("allowed_groups")
    @classmethod
    def _known_groups(cls, groups: list[str]) -> list[str]:
        return validate_allowed_groups(groups)


@dataclass(frozen=True)
class Services:
    registry: DocumentRegistry
    s3: Any
    search: Any
    bucket: str


@lru_cache(maxsize=1)
def get_services() -> Services:
    settings = get_settings()
    return Services(
        registry=DocumentRegistry(boto3.resource("dynamodb").Table(settings.registry_table)),
        # The regional endpoint: the global one redirects until a new bucket's DNS has spread.
        s3=boto3.client(
            "s3",
            region_name=settings.region,
            endpoint_url=f"https://s3.{settings.region}.amazonaws.com",
            config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        ),
        search=make_client(settings.search_endpoint, settings.region),
        bucket=settings.documents_bucket,
    )


Admin = Annotated[Principal, Depends(require_admin)]
ServicesDep = Annotated[Services, Depends(get_services)]


@router.get("")
def list_documents(admin: Admin, services: ServicesDep) -> list[dict[str, Any]]:
    return [asdict(document) for document in services.registry.list(admin.tenant_id)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_document(body: CreateDocument, admin: Admin, services: ServicesDep) -> dict[str, Any]:
    document = Document(
        tenant_id=admin.tenant_id,
        doc_id=uuid.uuid4().hex,
        title=body.title,
        content_type=body.content_type,
        size=body.size,
        allowed_groups=body.allowed_groups,
        created_by=admin.sub,
    )
    services.registry.create(document)
    upload = services.s3.generate_presigned_post(
        Bucket=services.bucket,
        Key=object_key(document.tenant_id, document.doc_id),
        Fields={"Content-Type": document.content_type},
        Conditions=[
            {"Content-Type": document.content_type},
            ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ],
        ExpiresIn=UPLOAD_EXPIRES_SECONDS,
    )
    audit("document_created", sub=admin.sub, tenant=admin.tenant_id, doc_id=document.doc_id)
    return {"document": asdict(document), "upload": upload}


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(doc_id: str, admin: Admin, services: ServicesDep) -> Response:
    """In order, so a failed step leaves DELETING and calling this again resumes it."""
    try:
        services.registry.transition(
            admin.tenant_id,
            doc_id,
            Status.DELETING,
            allowed_from={Status.PENDING, Status.INDEXED, Status.FAILED, Status.DELETING},
        )
    except StateConflictError as error:
        document = services.registry.get(admin.tenant_id, doc_id)
        if document is None:
            # Another company's document looks the same as one that doesn't exist.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found") from error
        raise HTTPException(status.HTTP_409_CONFLICT, "the document is processing") from error

    delete_document_chunks(services.search, admin.tenant_id, doc_id)
    services.s3.delete_object(Bucket=services.bucket, Key=object_key(admin.tenant_id, doc_id))
    services.registry.delete(admin.tenant_id, doc_id)
    audit("document_deleted", sub=admin.sub, tenant=admin.tenant_id, doc_id=doc_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
