"""The chunks index and the search pipeline behind hybrid queries (spec sections 6 and 8)."""

from typing import Any

CHUNKS_INDEX = "chunks"
HYBRID_PIPELINE = "hybrid-minmax"
EMBEDDING_DIMENSIONS = 1024

KEYWORD_WEIGHT = 0.3
VECTOR_WEIGHT = 0.7


def index_body() -> dict[str, Any]:
    return {
        # One node, so a replica would never be assigned and the index would stay yellow.
        "settings": {"index": {"knn": True, "number_of_shards": 1, "number_of_replicas": 0}},
        "mappings": {
            # A typo in a field name fails the write. An ACL field must never go missing quietly.
            "dynamic": "strict",
            "properties": {
                "tenant_id": {"type": "keyword"},
                "doc_id": {"type": "keyword"},
                "allowed_groups": {"type": "keyword"},
                "title": {"type": "text"},
                "heading_path": {"type": "text"},
                "text": {"type": "text", "analyzer": "english"},
                "page": {"type": "integer"},
                "chunk_index": {"type": "integer"},
                "embedding": {
                    "type": "knn_vector",
                    "dimension": EMBEDDING_DIMENSIONS,
                    "method": {"name": "hnsw", "engine": "faiss", "space_type": "cosinesimil"},
                },
            },
        },
    }


def pipeline_body() -> dict[str, Any]:
    return {
        "description": "Normalize keyword and vector scores, then combine them",
        "phase_results_processors": [
            {
                "normalization-processor": {
                    "normalization": {"technique": "min_max"},
                    "combination": {
                        "technique": "arithmetic_mean",
                        "parameters": {"weights": [KEYWORD_WEIGHT, VECTOR_WEIGHT]},
                    },
                }
            }
        ],
    }
