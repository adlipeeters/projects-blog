from typing import Any

from access_matrix import MatrixResult, check_hits, may_read
from personas import PERSONAS, Persona

HR = next(p for p in PERSONAS if p.username == "alderline-hr")
ENGINEER = next(p for p in PERSONAS if p.username == "alderline-engineer")
ADMIN = next(p for p in PERSONAS if p.username == "alderline-admin")
OTHER_HR = next(p for p in PERSONAS if p.username == "brightmoor-hr")


def entry(tenant: str, title: str, group: str, canary: str) -> dict[str, Any]:
    return {
        "tenant_id": tenant,
        "title": title,
        "allowed_groups": [group],
        "canary": canary,
        "path": f"{tenant}/{title}",
    }


SALARY = entry("alderline", "Salary", "hr", "CNRY-00000001")
OTHER_SALARY = entry("brightmoor", "Salary", "hr", "CNRY-00000002")
HOLIDAY = entry("alderline", "Holiday", "all-staff", "CNRY-00000003")
ENTRIES = [SALARY, OTHER_SALARY, HOLIDAY]
BY_CANARY = {e["canary"]: e for e in ENTRIES}
BY_DOCUMENT = {(e["tenant_id"], e["title"]): e for e in ENTRIES}


def source(e: dict[str, Any], text: str | None = None) -> dict[str, Any]:
    return {"tenant_id": e["tenant_id"], "title": e["title"], "text": text or e["canary"]}


def run(persona: Persona, target: dict[str, Any], hits: list[dict[str, Any]]) -> MatrixResult:
    result = MatrixResult()
    check_hits(persona, target, hits, BY_CANARY, BY_DOCUMENT, result)
    return result


def test_may_read_needs_the_tenant_and_a_group() -> None:
    assert may_read(HR, SALARY)
    assert may_read(ENGINEER, HOLIDAY)
    assert not may_read(ENGINEER, SALARY)
    assert not may_read(OTHER_HR, SALARY)
    assert not may_read(ADMIN, SALARY)


def test_a_clean_result_has_no_leaks_and_finds_the_target() -> None:
    result = run(HR, SALARY, [source(SALARY), source(HOLIDAY)])
    assert result.leaks == []
    assert (result.positive_expected, result.positive_found) == (1, 1)


def test_another_companys_chunk_is_a_leak() -> None:
    assert run(HR, SALARY, [source(OTHER_SALARY)]).leaks


def test_another_groups_chunk_is_a_leak() -> None:
    assert run(ENGINEER, SALARY, [source(SALARY)]).leaks


def test_a_foreign_canary_inside_allowed_text_is_a_leak() -> None:
    result = run(HR, HOLIDAY, [source(HOLIDAY, text="see CNRY-00000002")])
    assert result.leaks


def test_an_unknown_document_is_a_leak() -> None:
    hit = {"tenant_id": "alderline", "title": "Not in the manifest", "text": ""}
    assert run(HR, SALARY, [hit]).leaks


def test_a_missing_target_counts_against_the_positive_rate() -> None:
    result = run(HR, SALARY, [source(HOLIDAY)])
    assert (result.positive_expected, result.positive_found) == (1, 0)
    assert result.missing


def test_a_forbidden_target_is_not_expected() -> None:
    assert run(ENGINEER, SALARY, []).positive_expected == 0
