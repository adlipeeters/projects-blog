"""The demo accounts (spec section 4). Everyone is in all-staff."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Persona:
    username: str
    tenant_id: str
    groups: frozenset[str]


def _persona(tenant_id: str, role: str, group: str) -> Persona:
    return Persona(f"{tenant_id}-{role}", tenant_id, frozenset({"all-staff", group}))


PERSONAS = (
    _persona("alderline", "engineer", "engineering"),
    _persona("alderline", "hr", "hr"),
    _persona("alderline", "finance", "finance"),
    _persona("alderline", "legal", "legal"),
    _persona("alderline", "admin", "tenant-admin"),
    _persona("brightmoor", "engineer", "engineering"),
    _persona("brightmoor", "hr", "hr"),
    _persona("brightmoor", "admin", "tenant-admin"),
)
