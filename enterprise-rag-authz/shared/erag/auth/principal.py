from dataclasses import dataclass


@dataclass(frozen=True)
class Principal:
    """Who is asking. Built only from a verified access token, never from request data."""

    sub: str
    tenant_id: str
    groups: frozenset[str]

    def __post_init__(self) -> None:
        if not self.sub or not self.tenant_id:
            raise ValueError("a principal needs a subject and a tenant")
