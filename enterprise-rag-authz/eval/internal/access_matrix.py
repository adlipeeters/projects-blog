"""Runs inside the VPC as a one-off task (spec section 11). The rules here come from manifest.json
and personas.py, never from authz.py, so a bug in the access rules can't hide itself."""

import json
import os
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import boto3

from erag.auth.principal import Principal
from erag.authz import recheck
from erag.embeddings import embed_text
from erag.retrieval.client import make_client
from erag.retrieval.hybrid import build_hybrid_query
from erag.retrieval.index import CHUNKS_INDEX, HYBRID_PIPELINE
from personas import PERSONAS, Persona

MANIFEST = Path(os.environ.get("MANIFEST_PATH", "corpus/manifest.json"))
_CANARY = re.compile(r"CNRY-[0-9a-f]{8}")
RECHECK_QUESTIONS = 5
MIN_POSITIVE_RATE = 0.95


@dataclass
class MatrixResult:
    checks: int = 0
    leaks: list[str] = field(default_factory=list)
    positive_expected: int = 0
    positive_found: int = 0
    missing: list[str] = field(default_factory=list)


def may_read(persona: Persona, entry: dict[str, Any]) -> bool:
    return entry["tenant_id"] == persona.tenant_id and bool(
        set(entry["allowed_groups"]) & persona.groups
    )


def principal_for(persona: Persona) -> Principal:
    return Principal(
        sub=f"eval-{persona.username}", tenant_id=persona.tenant_id, groups=persona.groups
    )


def check_hits(
    persona: Persona,
    target: dict[str, Any],
    hits: Iterable[dict[str, Any]],
    by_canary: dict[str, dict[str, Any]],
    by_document: dict[tuple[str, str], dict[str, Any]],
    result: MatrixResult,
) -> None:
    """One persona asking for one canary document."""
    result.checks += 1
    found_target = False
    for source in hits:
        document = by_document.get((source.get("tenant_id", ""), source.get("title", "")))
        where = f"{persona.username} -> {source.get('tenant_id')}/{source.get('title')}"
        if document is None or not may_read(persona, document):
            result.leaks.append(where)
        for canary in _CANARY.findall(source.get("text", "")):
            owner = by_canary.get(canary)
            if owner is None or not may_read(persona, owner):
                result.leaks.append(f"{where} carries {canary}")
        if document is target:
            found_target = True

    if may_read(persona, target):
        result.positive_expected += 1
        if found_target:
            result.positive_found += 1
        else:
            result.missing.append(f"{persona.username} -> {target['path']}")


def run_matrix(
    search: Any,
    bedrock: Any,
    entries: list[dict[str, Any]],
) -> MatrixResult:
    by_canary = {entry["canary"]: entry for entry in entries}
    by_document = {(entry["tenant_id"], entry["title"]): entry for entry in entries}
    result = MatrixResult()
    for entry in entries:
        # The canary makes the keyword subquery match this document exactly, and the title points
        # the vector subquery at it, so only the filter can keep it out.
        question = f"{entry['title']} {entry['canary']}"
        vector = embed_text(bedrock, question)
        for persona in PERSONAS:
            body = build_hybrid_query(principal_for(persona), question, vector, size=30)
            hits = _search(search, body)
            check_hits(persona, entry, hits, by_canary, by_document, result)
    return result


def run_recheck_proof(search: Any, bedrock: Any, entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Takes the filter away and checks the recheck alone. This query exists only in this image."""
    by_document = {(entry["tenant_id"], entry["title"]): entry for entry in entries}
    foreign = dropped = wrongly_allowed = wrongly_dropped = 0
    for persona in PERSONAS:
        principal = principal_for(persona)
        for entry in entries[:: max(1, len(entries) // RECHECK_QUESTIONS)][:RECHECK_QUESTIONS]:
            question = f"{entry['title']} {entry['canary']}"
            body = build_hybrid_query(principal, question, embed_text(bedrock, question), size=30)
            del body["query"]["hybrid"]["filter"]
            for source in _search(search, body):
                document = by_document.get((source.get("tenant_id", ""), source.get("title", "")))
                allowed = document is not None and may_read(persona, document)
                kept = recheck(principal, source)
                foreign += not allowed
                dropped += not kept
                wrongly_allowed += kept and not allowed
                wrongly_dropped += allowed and not kept
    return {
        "foreign_chunks_returned": foreign,
        "dropped_by_recheck": dropped,
        "foreign_kept": wrongly_allowed,
        "allowed_dropped": wrongly_dropped,
        "ok": foreign > 0 and not wrongly_allowed and not wrongly_dropped,
    }


def _search(search: Any, body: dict[str, Any]) -> list[dict[str, Any]]:
    response = search.search(
        index=CHUNKS_INDEX, body=body, params={"search_pipeline": HYBRID_PIPELINE}
    )
    return [hit["_source"] for hit in response["hits"]["hits"]]


def main() -> int:
    entries: list[dict[str, Any]] = json.loads(MANIFEST.read_text())
    region = os.environ["AWS_REGION"]
    search = make_client(os.environ["SEARCH_ENDPOINT"], region)
    bedrock = boto3.client("bedrock-runtime", region_name=region)

    matrix = run_matrix(search, bedrock, entries)
    proof = run_recheck_proof(search, bedrock, entries)
    rate = matrix.positive_found / matrix.positive_expected if matrix.positive_expected else 0.0
    report = {
        "matrix_checks": matrix.checks,
        "leaks": len(matrix.leaks),
        "leak_examples": matrix.leaks[:20],
        "positive_expected": matrix.positive_expected,
        "positive_found": matrix.positive_found,
        "positive_rate": round(rate, 4),
        "missing_examples": matrix.missing[:20],
        "recheck_proof": proof,
    }
    ok = not matrix.leaks and rate >= MIN_POSITIVE_RATE and proof["ok"]
    # The same audit shape the API writes, so the proof reaches the real metric filter and alarm.
    print(
        json.dumps(
            {"audit": "question", "source": "recheck-proof", "dropped": proof["dropped_by_recheck"]}
        )
    )
    print(json.dumps({"report": report, "ok": ok}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
