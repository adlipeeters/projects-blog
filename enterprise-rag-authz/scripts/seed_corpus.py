"""Upload corpus/ through the real admin API, as each company's admin, and wait until every
document is INDEXED. Safe to run again: titles already uploaded are skipped."""

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

from session import access_token

TIMEOUT_SECONDS = 1200


def upload(api: httpx.Client, entry: dict[str, Any]) -> None:
    data = Path(entry["path"]).read_bytes()
    response = api.post(
        "/api/admin/documents",
        json={
            "title": entry["title"],
            "content_type": entry["content_type"],
            "size": len(data),
            "allowed_groups": entry["allowed_groups"],
        },
    )
    response.raise_for_status()
    target = response.json()["upload"]
    httpx.post(target["url"], data=target["fields"], files={"file": data}).raise_for_status()


def delete_pdfs(api: httpx.Client) -> None:
    """For a corpus fix: the next upload then carries the regenerated files."""
    documents = api.get("/api/admin/documents").raise_for_status().json()
    pdfs = [doc for doc in documents if doc["content_type"] == "application/pdf"]
    for doc in pdfs:
        api.delete(f"/api/admin/documents/{doc['doc_id']}").raise_for_status()
    print(f"deleted {len(pdfs)} PDFs")


def seed_tenant(
    base_url: str, tenant_id: str, entries: list[dict[str, Any]], replace_pdfs: bool
) -> bool:
    headers = {"Authorization": f"Bearer {access_token(f'{tenant_id}-admin')}"}
    with httpx.Client(base_url=base_url, headers=headers, timeout=30) as api:
        if replace_pdfs:
            delete_pdfs(api)
        existing = {
            doc["title"] for doc in api.get("/api/admin/documents").raise_for_status().json()
        }
        todo = [entry for entry in entries if entry["title"] not in existing]
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda entry: upload(api, entry), todo))
        print(f"{tenant_id}: uploaded {len(todo)}, already there {len(existing)}")

        deadline = time.monotonic() + TIMEOUT_SECONDS
        while True:
            documents = api.get("/api/admin/documents").raise_for_status().json()
            statuses = [doc["status"] for doc in documents]
            indexed = statuses.count("INDEXED")
            failed = [doc["title"] for doc in documents if doc["status"] == "FAILED"]
            print(f"{tenant_id}: {indexed}/{len(entries)} indexed, {len(failed)} failed")
            if indexed + len(failed) >= len(entries):
                chunks = sum(doc["chunk_count"] for doc in documents)
                print(f"{tenant_id}: {chunks} chunks; failed: {failed}")
                return not failed
            if time.monotonic() > deadline:
                return False
            time.sleep(15)


def main() -> int:
    entries = json.loads(Path("corpus/manifest.json").read_text())
    tenants = sorted({entry["tenant_id"] for entry in entries})
    results = [
        seed_tenant(
            os.environ["API_URL"],
            tenant,
            [entry for entry in entries if entry["tenant_id"] == tenant],
            "--replace-pdfs" in sys.argv,
        )
        for tenant in tenants
    ]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
