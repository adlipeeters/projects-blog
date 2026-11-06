from collections.abc import Sequence
from typing import Any

from erag.auth.principal import Principal
from erag.authz import build_filter


def build_hybrid_query(
    principal: Principal, question: str, vector: Sequence[float], size: int = 30
) -> dict[str, Any]:
    """The only query the app runs against the chunks index.

    The ACL goes in the top-level `filter`, which OpenSearch applies to each subquery before
    scoring. `post_filter` would run after retrieval and leave low-privilege users with few or no
    results.
    """
    return {
        "size": size,
        "_source": {"excludes": ["embedding"]},
        "query": {
            "hybrid": {
                "queries": [
                    {"match": {"text": {"query": question}}},
                    {"knn": {"embedding": {"vector": list(vector), "k": size}}},
                ],
                "filter": build_filter(principal),
            }
        },
    }
