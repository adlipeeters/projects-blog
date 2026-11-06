import io
import json
from typing import Any
from unittest.mock import MagicMock

from erag.auth.principal import Principal
from erag.retrieval.index import HYBRID_PIPELINE
from erag_api.retrieve import Excerpt, rerank, retrieve

HR = Principal("user-1", "alderline", frozenset({"hr", "all-staff"}))


def hit(
    doc_id: str, tenant: str = "alderline", groups: tuple[str, ...] = ("hr",)
) -> dict[str, Any]:
    return {
        "_id": f"{doc_id}:0",
        "_score": 0.9,
        "_source": {
            "doc_id": doc_id,
            "tenant_id": tenant,
            "allowed_groups": list(groups),
            "title": doc_id,
            "heading_path": "",
            "page": None,
            "text": f"text of {doc_id}",
        },
    }


def bedrock() -> MagicMock:
    client = MagicMock()
    client.invoke_model.return_value = {
        "body": io.BytesIO(json.dumps({"embedding": [0.1]}).encode())
    }
    return client


def test_the_filter_and_pipeline_go_to_opensearch() -> None:
    search = MagicMock()
    search.search.return_value = {"hits": {"hits": []}}
    retrieve(search, bedrock(), HR, "salary")
    kwargs = search.search.call_args.kwargs
    assert kwargs["params"] == {"search_pipeline": HYBRID_PIPELINE}
    assert kwargs["body"]["query"]["hybrid"]["filter"]["bool"]["filter"][0] == {
        "term": {"tenant_id": "alderline"}
    }


def test_the_recheck_drops_what_a_broken_filter_lets_through() -> None:
    search = MagicMock()
    search.search.return_value = {
        "hits": {
            "hits": [
                hit("mine"),
                hit("other-company", tenant="brightmoor"),
                hit("other-group", groups=("finance",)),
            ]
        }
    }
    found = retrieve(search, bedrock(), HR, "salary")
    assert [excerpt.doc_id for excerpt in found.excerpts] == ["mine"]
    assert found.dropped == 2
    assert found.dropped_doc_ids == ["other-company", "other-group"]


def test_a_user_with_no_read_groups_never_searches() -> None:
    search = MagicMock()
    admin = Principal("admin-1", "alderline", frozenset({"tenant-admin"}))
    assert retrieve(search, bedrock(), admin, "salary").excerpts == []
    search.search.assert_not_called()


def test_excerpts_carry_no_opensearch_score() -> None:
    search = MagicMock()
    search.search.return_value = {"hits": {"hits": [hit("mine")]}}
    assert retrieve(search, bedrock(), HR, "salary").excerpts[0].score == 0.0


def excerpt(doc_id: str) -> Excerpt:
    return Excerpt(doc_id, doc_id, "", None, f"text of {doc_id}")


def test_rerank_orders_by_score_and_applies_the_threshold() -> None:
    agent = MagicMock()
    agent.rerank.return_value = {
        "results": [
            {"index": 1, "relevanceScore": 0.9},
            {"index": 0, "relevanceScore": 0.5},
            {"index": 2, "relevanceScore": 0.01},
        ]
    }
    ranked = rerank(
        agent, "eu-central-1", "q", [excerpt("a"), excerpt("b"), excerpt("c")], min_score=0.1
    )
    assert [(e.doc_id, e.score) for e in ranked] == [("b", 0.9), ("a", 0.5)]


def test_rerank_skips_the_call_with_nothing_to_rank() -> None:
    agent = MagicMock()
    assert rerank(agent, "eu-central-1", "q", [], min_score=0.1) == []
    agent.rerank.assert_not_called()
