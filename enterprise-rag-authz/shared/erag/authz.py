"""The access rules. Every search and every upload goes through this file, so it stays small
enough to audit and imports nothing from AWS."""

from collections.abc import Iterable, Mapping
from typing import Any

from erag.auth.principal import Principal

READ_GROUPS = frozenset({"all-staff", "engineering", "hr", "finance", "legal"})

# Manages a company's documents. Grants no read access, so it is not in READ_GROUPS.
ADMIN_GROUP = "tenant-admin"


class NoReadAccessError(Exception):
    """The principal has no read groups, so there is nothing to search."""


def read_groups(principal: Principal) -> list[str]:
    return sorted(principal.groups & READ_GROUPS)


def is_admin(principal: Principal) -> bool:
    return ADMIN_GROUP in principal.groups


def build_filter(principal: Principal) -> dict[str, Any]:
    """The filter for the hybrid query's top-level `filter`, which covers every subquery."""
    groups = read_groups(principal)
    if not groups:
        # An empty `terms` list must never reach OpenSearch. Callers answer "not found" instead.
        raise NoReadAccessError
    return {
        "bool": {
            "filter": [
                {"term": {"tenant_id": principal.tenant_id}},
                {"terms": {"allowed_groups": groups}},
            ]
        }
    }


def recheck(principal: Principal, source: Mapping[str, object]) -> bool:
    """Test a returned chunk's own ACL fields before its text goes anywhere.

    Catches a broken filter. Anything malformed is denied.
    """
    tenant_id = source.get("tenant_id")
    allowed_groups = source.get("allowed_groups")
    if not isinstance(tenant_id, str) or not isinstance(allowed_groups, list):
        return False
    return tenant_id == principal.tenant_id and bool(
        READ_GROUPS.intersection(g for g in allowed_groups if isinstance(g, str)) & principal.groups
    )


def validate_allowed_groups(groups: Iterable[str]) -> list[str]:
    """Check the groups an admin picked for a document. Fails on anything outside the list."""
    chosen = set(groups)
    if not chosen:
        raise ValueError("a document needs at least one group")
    unknown = chosen - READ_GROUPS
    if unknown:
        raise ValueError(f"not read groups: {sorted(unknown)}")
    return sorted(chosen)
