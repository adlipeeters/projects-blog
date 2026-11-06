import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    region: str
    issuer: str
    client_ids: frozenset[str]
    registry_table: str
    documents_bucket: str
    search_endpoint: str
    answer_model: str
    guardrail_id: str
    guardrail_version: str
    rerank_min_score: float


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        region=os.environ["AWS_REGION"],
        issuer=os.environ["COGNITO_ISSUER"],
        client_ids=frozenset(os.environ["COGNITO_CLIENT_IDS"].split(",")),
        registry_table=os.environ["REGISTRY_TABLE"],
        documents_bucket=os.environ["DOCUMENTS_BUCKET"],
        search_endpoint=os.environ["SEARCH_ENDPOINT"],
        answer_model=os.environ["ANSWER_MODEL"],
        guardrail_id=os.environ["GUARDRAIL_ID"],
        guardrail_version=os.environ["GUARDRAIL_VERSION"],
        rerank_min_score=float(os.environ["RERANK_MIN_SCORE"]),
    )
