from typing import Any

import pytest

from erag.auth.principal import Principal
from erag.authz import (
    NoReadAccessError,
    build_filter,
    is_admin,
    read_groups,
    recheck,
    validate_allowed_groups,
)


def principal(*groups: str, tenant: str = "alderline") -> Principal:
    return Principal(sub="user-1", tenant_id=tenant, groups=frozenset(groups))


def source(tenant: Any = "alderline", groups: Any = ("hr",)) -> dict[str, Any]:
    return {
        "tenant_id": tenant,
        "allowed_groups": list(groups) if isinstance(groups, tuple) else groups,
    }


def test_principal_needs_a_tenant_and_a_subject() -> None:
    with pytest.raises(ValueError):
        Principal(sub="user-1", tenant_id="", groups=frozenset())
    with pytest.raises(ValueError):
        Principal(sub="", tenant_id="alderline", groups=frozenset())


def test_read_groups_ignore_admin_and_unknown_groups() -> None:
    assert read_groups(principal("hr", "all-staff", "tenant-admin", "made-up")) == [
        "all-staff",
        "hr",
    ]


def test_is_admin() -> None:
    assert is_admin(principal("all-staff", "tenant-admin"))
    assert not is_admin(principal("all-staff", "hr"))


def test_filter_scopes_to_the_tenant_and_the_read_groups() -> None:
    assert build_filter(principal("hr", "all-staff", "tenant-admin", tenant="brightmoor")) == {
        "bool": {
            "filter": [
                {"term": {"tenant_id": "brightmoor"}},
                {"terms": {"allowed_groups": ["all-staff", "hr"]}},
            ]
        }
    }


@pytest.mark.parametrize("groups", [(), ("tenant-admin",), ("made-up",)])
def test_filter_refuses_a_principal_with_no_read_groups(groups: tuple[str, ...]) -> None:
    with pytest.raises(NoReadAccessError):
        build_filter(principal(*groups))


def test_recheck_allows_a_matching_tenant_and_group() -> None:
    assert recheck(principal("hr"), source(groups=("hr", "legal")))


@pytest.mark.parametrize(
    ("user", "chunk"),
    [
        (principal("hr"), source(tenant="brightmoor")),
        (principal("engineering"), source()),
        (principal(), source()),
        (principal("tenant-admin"), source(groups=("tenant-admin",))),
        (principal("made-up"), source(groups=("made-up",))),
    ],
)
def test_recheck_denies(user: Principal, chunk: dict[str, Any]) -> None:
    assert not recheck(user, chunk)


@pytest.mark.parametrize(
    "chunk",
    [
        {},
        {"tenant_id": "alderline"},
        {"allowed_groups": ["hr"]},
        source(tenant=None),
        source(tenant=["alderline"]),
        source(groups=None),
        source(groups="hr"),
        source(groups=[]),
        source(groups=[None, 1]),
    ],
)
def test_recheck_denies_malformed_chunks(chunk: dict[str, Any]) -> None:
    assert not recheck(principal("hr"), chunk)


def test_validate_allowed_groups_sorts_and_removes_duplicates() -> None:
    assert validate_allowed_groups(["legal", "hr", "legal"]) == ["hr", "legal"]


@pytest.mark.parametrize("groups", [[], ["tenant-admin"], ["hr", "made-up"]])
def test_validate_allowed_groups_rejects(groups: list[str]) -> None:
    with pytest.raises(ValueError):
        validate_allowed_groups(groups)
