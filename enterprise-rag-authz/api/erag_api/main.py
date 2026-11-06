from typing import Annotated

from fastapi import Depends, FastAPI

from erag.auth.principal import Principal
from erag.authz import read_groups
from erag_api.auth import current_principal
from erag_api.chat import get_usage
from erag_api.chat import router as chat_router
from erag_api.documents import router as documents_router
from erag_api.usage import UsageTracker

# No docs routes: nothing here needs a public schema.
app = FastAPI(title="Enterprise RAG Authz", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(documents_router)
app.include_router(chat_router)


@app.get("/health")
def health() -> dict[str, str]:
    """No dependencies, so a search outage doesn't make the ALB drop every task."""
    return {"status": "ok"}


@app.get("/api/me")
def me(
    principal: Annotated[Principal, Depends(current_principal)],
    usage: Annotated[UsageTracker, Depends(get_usage)],
) -> dict[str, object]:
    return {
        "tenant_id": principal.tenant_id,
        "groups": sorted(principal.groups),
        "read_groups": read_groups(principal),
        **usage.remaining(principal.sub),
    }
