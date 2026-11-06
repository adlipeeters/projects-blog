import json
import os
import time
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import boto3
import httpx
import pytest

from session import access_token


@pytest.fixture(scope="session")
def api_url() -> str:
    return os.environ["API_URL"]


@pytest.fixture(scope="session")
def client_for(api_url: str) -> Iterator[Callable[[str], httpx.Client]]:
    clients: dict[str, httpx.Client] = {}

    def make(username: str) -> httpx.Client:
        if username not in clients:
            headers = {"Authorization": f"Bearer {access_token(username)}"}
            clients[username] = httpx.Client(base_url=api_url, headers=headers, timeout=30)
        return clients[username]

    yield make
    for client in clients.values():
        client.close()


@pytest.fixture(scope="session")
def chunk_count() -> Callable[[str, str], int]:
    lambda_client = boto3.client("lambda")

    def count(tenant_id: str, doc_id: str) -> int:
        response = lambda_client.invoke(
            FunctionName=os.environ["SEARCH_ADMIN_FUNCTION"],
            Payload=json.dumps({"action": "count", "tenant_id": tenant_id, "doc_id": doc_id}),
        )
        return int(json.loads(response["Payload"].read())["count"])

    return count


def unique_title(label: str) -> str:
    return f"eval {label} {uuid.uuid4().hex[:8]}"


def create(
    client: httpx.Client, title: str, data: bytes, content_type: str = "text/markdown"
) -> dict[str, Any]:
    response = client.post(
        "/api/admin/documents",
        json={
            "title": title,
            "content_type": content_type,
            "size": len(data),
            "allowed_groups": ["hr"],
        },
    )
    response.raise_for_status()
    created: dict[str, Any] = response.json()
    return created


def post_file(upload: dict[str, Any], data: bytes) -> httpx.Response:
    return httpx.post(upload["url"], data=upload["fields"], files={"file": data}, timeout=60)


def wait_for_status(client: httpx.Client, doc_id: str, wanted: str) -> dict[str, Any]:
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        documents = client.get("/api/admin/documents").raise_for_status().json()
        document: dict[str, Any] | None = next(
            (doc for doc in documents if doc["doc_id"] == doc_id), None
        )
        if document and document["status"] == wanted:
            return document
        time.sleep(3)
    raise AssertionError(f"{doc_id} never reached {wanted}")


def ask(client: httpx.Client, question: str) -> dict[str, Any]:
    """Send a question and collect the SSE events. The suites send more than the per-user limit
    allows in a minute, so a 429 waits for the next one."""
    for _ in range(6):
        events: dict[str, Any] = {"tokens": "", "names": []}
        with client.stream(
            "POST", "/api/chat", json={"question": question}, timeout=90
        ) as response:
            if response.status_code == 429:
                time.sleep(20)
                continue
            response.raise_for_status()
            name = ""
            for line in response.iter_lines():
                if line.startswith("event: "):
                    name = line.removeprefix("event: ")
                    events["names"].append(name)
                elif line.startswith("data: "):
                    data = json.loads(line.removeprefix("data: "))
                    if name == "token":
                        events["tokens"] += data["text"]
                    else:
                        events[name] = data
        return events
    raise AssertionError("still rate limited after retries")


def unique_results_path(label: str) -> Path:
    results = Path("results")
    results.mkdir(exist_ok=True)
    return results / f"{label}-{uuid.uuid4().hex[:8]}.json"
