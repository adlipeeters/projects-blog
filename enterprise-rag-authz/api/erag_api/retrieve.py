"""From a question to the excerpts a user may read (spec section 8). The filter does the work and
the recheck catches a broken filter. Nothing past this file ever sees a dropped chunk."""

from dataclasses import dataclass
from typing import Any

from erag.auth.principal import Principal
from erag.authz import read_groups, recheck
from erag.embeddings import embed_text
from erag.retrieval.hybrid import build_hybrid_query
from erag.retrieval.index import CHUNKS_INDEX, HYBRID_PIPELINE

RERANK_MODEL = "amazon.rerank-v1:0"
RETRIEVE_SIZE = 30
RERANK_TOP = 5


@dataclass(frozen=True)
class Excerpt:
    doc_id: str
    title: str
    heading_path: str
    page: int | None
    text: str
    score: float = 0.0


@dataclass(frozen=True)
class Retrieved:
    excerpts: list[Excerpt]
    dropped: int
    dropped_doc_ids: list[str]


def retrieve(search: Any, bedrock_runtime: Any, principal: Principal, question: str) -> Retrieved:
    if not read_groups(principal):
        return Retrieved([], 0, [])

    vector = embed_text(bedrock_runtime, question)
    response = search.search(
        index=CHUNKS_INDEX,
        body=build_hybrid_query(principal, question, vector, size=RETRIEVE_SIZE),
        params={"search_pipeline": HYBRID_PIPELINE},
    )
    # OpenSearch scores stop here: term statistics are shared across tenants in one index.
    sources = [hit["_source"] for hit in response["hits"]["hits"]]
    allowed = [source for source in sources if recheck(principal, source)]
    dropped = [source for source in sources if not recheck(principal, source)]
    return Retrieved(
        excerpts=[_excerpt(source) for source in allowed],
        dropped=len(dropped),
        dropped_doc_ids=sorted({str(source.get("doc_id")) for source in dropped}),
    )


def rerank(
    agent_runtime: Any, region: str, question: str, excerpts: list[Excerpt], min_score: float
) -> list[Excerpt]:
    """The top excerpts above the threshold. An empty list means the standard "not found" answer."""
    if not excerpts:
        return []
    response = agent_runtime.rerank(
        queries=[{"type": "TEXT", "textQuery": {"text": question}}],
        sources=[
            {
                "type": "INLINE",
                "inlineDocumentSource": {"type": "TEXT", "textDocument": {"text": _rerank_text(e)}},
            }
            for e in excerpts
        ],
        rerankingConfiguration={
            "type": "BEDROCK_RERANKING_MODEL",
            "bedrockRerankingConfiguration": {
                "numberOfResults": min(RERANK_TOP, len(excerpts)),
                "modelConfiguration": {
                    "modelArn": f"arn:aws:bedrock:{region}::foundation-model/{RERANK_MODEL}"
                },
            },
        },
    )
    ranked = [
        Excerpt(**{**excerpts[result["index"]].__dict__, "score": float(result["relevanceScore"])})
        for result in response["results"]
    ]
    return [excerpt for excerpt in ranked if excerpt.score >= min_score]


def _rerank_text(excerpt: Excerpt) -> str:
    location = " > ".join(part for part in (excerpt.title, excerpt.heading_path) if part)
    return f"{location}\n\n{excerpt.text}"


def _excerpt(source: dict[str, Any]) -> Excerpt:
    return Excerpt(
        doc_id=source["doc_id"],
        title=source.get("title") or "",
        heading_path=source.get("heading_path") or "",
        page=source.get("page"),
        text=source.get("text") or "",
    )
