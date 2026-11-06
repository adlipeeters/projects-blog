"""End-to-end access through CloudFront: the model, citations and panel, on a sample. The whole
matrix runs at retrieval level in the internal task."""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest

from conftest import ask
from personas import PERSONAS, Persona

ClientFor = Callable[[str], httpx.Client]
MANIFEST: list[dict[str, Any]] = json.loads(Path("corpus/manifest.json").read_text())
SAMPLES_PER_PERSONA = 12


def may_read(persona: Persona, entry: dict[str, Any]) -> bool:
    return entry["tenant_id"] == persona.tenant_id and bool(
        set(entry["allowed_groups"]) & persona.groups
    )


def forbidden_sample(persona: Persona) -> list[dict[str, Any]]:
    forbidden = [entry for entry in MANIFEST if not may_read(persona, entry)]
    same = [entry for entry in forbidden if entry["tenant_id"] == persona.tenant_id]
    other = [entry for entry in forbidden if entry["tenant_id"] != persona.tenant_id]
    half = SAMPLES_PER_PERSONA // 2
    return same[:: max(1, len(same) // half)][:half] + other[:: max(1, len(other) // half)][:half]


def allowed_sample(persona: Persona) -> list[dict[str, Any]]:
    allowed = [entry for entry in MANIFEST if may_read(persona, entry) and not entry["injection"]]
    return allowed[:: max(1, len(allowed) // 3)][:3]


NEGATIVE = [(p.username, e) for p in PERSONAS for e in forbidden_sample(p)]
POSITIVE = [(p.username, e) for p in PERSONAS for e in allowed_sample(p)]


@pytest.mark.parametrize(
    ("username", "entry"), NEGATIVE, ids=lambda v: v if isinstance(v, str) else v["path"]
)
def test_a_forbidden_document_leaves_no_trace(
    client_for: ClientFor, username: str, entry: dict[str, Any]
) -> None:
    result = ask(client_for(username), entry["canary_question"])
    # Covers the answer, the citations and the panel's excerpt text.
    assert entry["canary"] not in json.dumps(result)
    assert result["retrieval"]["dropped"] == 0


@pytest.mark.parametrize(
    ("username", "entry"), POSITIVE, ids=lambda v: v if isinstance(v, str) else v["path"]
)
def test_the_right_person_gets_the_canary(
    client_for: ClientFor, username: str, entry: dict[str, Any]
) -> None:
    result = ask(client_for(username), entry["canary_question"])
    assert entry["canary"] in json.dumps(result["retrieval"]), "not retrieved"
