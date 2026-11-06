"""Admin isolation, ingestion and deletion against the deployed stack (spec section 11)."""

import json
import os
import time
from collections.abc import Callable

import boto3
import httpx
import pytest

from conftest import create, post_file, unique_title, wait_for_status

ClientFor = Callable[[str], httpx.Client]
ChunkCount = Callable[[str, str], int]
MARKDOWN = b"# Leave\n\nEval document about leave rules.\n"


def test_no_token_gets_401(api_url: str) -> None:
    assert httpx.get(f"{api_url}/api/admin/documents").status_code == 401


def test_a_tampered_token_gets_401(api_url: str, client_for: ClientFor) -> None:
    token = client_for("alderline-admin").headers["Authorization"].removeprefix("Bearer ")
    header, payload, signature = token.split(".")
    tampered = f"{header}.{payload}.{signature[:-4]}AAAA"
    response = httpx.get(
        f"{api_url}/api/admin/documents", headers={"Authorization": f"Bearer {tampered}"}
    )
    assert response.status_code == 401


@pytest.mark.parametrize("username", ["alderline-hr", "alderline-engineer", "brightmoor-hr"])
def test_non_admins_get_403(client_for: ClientFor, username: str) -> None:
    client = client_for(username)
    assert client.get("/api/admin/documents").status_code == 403
    assert client.delete("/api/admin/documents/anything").status_code == 403


def test_me_reports_the_token(client_for: ClientFor) -> None:
    body = client_for("brightmoor-hr").get("/api/me").json()
    assert body["tenant_id"] == "brightmoor"
    assert body["read_groups"] == ["all-staff", "hr"]


def test_a_tenant_in_the_body_or_header_has_no_effect(client_for: ClientFor) -> None:
    admin = client_for("alderline-admin")
    response = admin.post(
        "/api/admin/documents",
        headers={"X-Tenant-Id": "brightmoor"},
        params={"tenant_id": "brightmoor"},
        json={
            "title": unique_title("spoof"),
            "content_type": "text/markdown",
            "size": 10,
            "allowed_groups": ["hr"],
            "tenant_id": "brightmoor",
        },
    )
    assert response.status_code == 201
    document = response.json()["document"]
    assert document["tenant_id"] == "alderline"
    assert admin.delete(f"/api/admin/documents/{document['doc_id']}").status_code == 204


@pytest.mark.parametrize(
    "bad",
    [
        {"content_type": "text/html"},
        {"size": 10 * 1024 * 1024 + 1},
        {"allowed_groups": []},
        {"allowed_groups": ["tenant-admin"]},
        {"allowed_groups": ["made-up"]},
    ],
)
def test_invalid_uploads_are_refused(client_for: ClientFor, bad: dict[str, object]) -> None:
    body = {
        "title": unique_title("invalid"),
        "content_type": "text/markdown",
        "size": 10,
        "allowed_groups": ["hr"],
    }
    response = client_for("alderline-admin").post("/api/admin/documents", json={**body, **bad})
    assert response.status_code == 422


def test_s3_refuses_a_file_over_the_limit(client_for: ClientFor) -> None:
    admin = client_for("alderline-admin")
    created = create(admin, unique_title("oversize"), b"x" * 10)
    response = post_file(created["upload"], b"x" * (10 * 1024 * 1024 + 1))
    assert response.status_code == 400
    assert "EntityTooLarge" in response.text
    assert admin.delete(f"/api/admin/documents/{created['document']['doc_id']}").status_code == 204


def test_the_presigned_post_cannot_write_another_key(client_for: ClientFor) -> None:
    admin = client_for("alderline-admin")
    created = create(admin, unique_title("wrong-key"), MARKDOWN)
    upload = created["upload"]
    fields = {**upload["fields"], "key": "brightmoor/stolen"}
    response = httpx.post(upload["url"], data=fields, files={"file": MARKDOWN}, timeout=60)
    assert response.status_code == 403
    assert admin.delete(f"/api/admin/documents/{created['document']['doc_id']}").status_code == 204


def test_upload_index_duplicate_event_and_delete(
    client_for: ClientFor, chunk_count: ChunkCount
) -> None:
    admin = client_for("alderline-admin")
    created = create(admin, unique_title("lifecycle"), MARKDOWN)
    document = created["document"]
    doc_id = document["doc_id"]
    key = f"alderline/{doc_id}"
    assert post_file(created["upload"], MARKDOWN).status_code == 204

    indexed = wait_for_status(admin, doc_id, "INDEXED")
    assert indexed["chunk_count"] > 0
    assert chunk_count("alderline", doc_id) == indexed["chunk_count"]

    # The other company's admin can see nothing of it and can't delete it.
    other = client_for("brightmoor-admin")
    listed = other.get("/api/admin/documents").json()
    assert doc_id not in {doc["doc_id"] for doc in listed}
    assert other.delete(f"/api/admin/documents/{doc_id}").status_code == 404
    assert chunk_count("alderline", doc_id) == indexed["chunk_count"]

    # A duplicate S3 event changes nothing.
    boto3.client("sqs").send_message(
        QueueUrl=os.environ["INGEST_QUEUE_URL"],
        MessageBody=json.dumps({"Records": [{"s3": {"object": {"key": key}}}]}),
    )
    time.sleep(20)
    assert wait_for_status(admin, doc_id, "INDEXED")["chunk_count"] == indexed["chunk_count"]

    assert admin.delete(f"/api/admin/documents/{doc_id}").status_code == 204
    assert chunk_count("alderline", doc_id) == 0
    assert doc_id not in {doc["doc_id"] for doc in admin.get("/api/admin/documents").json()}
    objects = boto3.client("s3").list_objects_v2(Bucket=os.environ["DOCUMENTS_BUCKET"], Prefix=key)
    assert objects["KeyCount"] == 0
    assert admin.delete(f"/api/admin/documents/{doc_id}").status_code == 404


def test_a_bad_pdf_fails_without_chunks_and_can_be_deleted(
    client_for: ClientFor, chunk_count: ChunkCount
) -> None:
    admin = client_for("alderline-admin")
    junk = b"this is not a pdf"
    created = create(admin, unique_title("bad-pdf"), junk, "application/pdf")
    doc_id = created["document"]["doc_id"]
    assert post_file(created["upload"], junk).status_code == 204

    failed = wait_for_status(admin, doc_id, "FAILED")
    assert failed["error"] == "the PDF can't be read"
    assert chunk_count("alderline", doc_id) == 0
    assert admin.delete(f"/api/admin/documents/{doc_id}").status_code == 204


def test_a_file_with_no_record_is_removed_and_never_indexed(chunk_count: ChunkCount) -> None:
    s3 = boto3.client("s3")
    bucket = os.environ["DOCUMENTS_BUCKET"]
    key = "alderline/unregistered-eval-object"
    s3.put_object(Bucket=bucket, Key=key, Body=MARKDOWN, ContentType="text/markdown")

    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if s3.list_objects_v2(Bucket=bucket, Prefix=key)["KeyCount"] == 0:
            break
        time.sleep(3)
    else:
        raise AssertionError("the unregistered object is still there")
    assert chunk_count("alderline", "unregistered-eval-object") == 0
