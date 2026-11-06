import json

import pytest

from erag.auth.principal import Principal
from erag.authz import NoReadAccessError, build_filter
from erag.retrieval.hybrid import build_hybrid_query
from erag.retrieval.index import EMBEDDING_DIMENSIONS, index_body, pipeline_body

HR = Principal("user-1", "alderline", frozenset({"hr", "all-staff"}))


def test_the_acl_is_in_the_top_level_filter() -> None:
    query = build_hybrid_query(HR, "salary bands", [0.1, 0.2])
    assert query["query"]["hybrid"]["filter"] == build_filter(HR)


def test_post_filter_is_never_used() -> None:
    assert "post_filter" not in json.dumps(build_hybrid_query(HR, "salary bands", [0.1]))


def test_both_subqueries_are_present() -> None:
    match, knn = build_hybrid_query(HR, "salary", [0.1], size=30)["query"]["hybrid"]["queries"]
    assert match == {"match": {"text": {"query": "salary"}}}
    assert knn == {"knn": {"embedding": {"vector": [0.1], "k": 30}}}


def test_embeddings_stay_out_of_the_response() -> None:
    assert build_hybrid_query(HR, "salary", [0.1])["_source"] == {"excludes": ["embedding"]}


def test_a_principal_with_no_read_groups_gets_no_query() -> None:
    admin = Principal("user-2", "alderline", frozenset({"tenant-admin"}))
    with pytest.raises(NoReadAccessError):
        build_hybrid_query(admin, "salary", [0.1])


def test_the_index_rejects_unknown_fields() -> None:
    assert index_body()["mappings"]["dynamic"] == "strict"


def test_acl_fields_are_exact_match_keywords() -> None:
    properties = index_body()["mappings"]["properties"]
    assert properties["tenant_id"]["type"] == "keyword"
    assert properties["allowed_groups"]["type"] == "keyword"


def test_vector_size_matches_the_embedding_model() -> None:
    embedding = index_body()["mappings"]["properties"]["embedding"]
    assert embedding["dimension"] == EMBEDDING_DIMENSIONS == 1024


def test_pipeline_weights_add_up() -> None:
    processor = pipeline_body()["phase_results_processors"][0]["normalization-processor"]
    weights = processor["combination"]["parameters"]["weights"]
    assert sum(weights) == pytest.approx(1)
