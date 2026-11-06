import json
from typing import Any

from erag.retrieval.index import EMBEDDING_DIMENSIONS

EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"


def embed_text(bedrock_runtime: Any, text: str) -> list[float]:
    response = bedrock_runtime.invoke_model(
        modelId=EMBEDDING_MODEL,
        contentType="application/json",
        accept="application/json",
        body=json.dumps({"inputText": text, "dimensions": EMBEDDING_DIMENSIONS, "normalize": True}),
    )
    embedding: list[float] = json.loads(response["body"].read())["embedding"]
    return embedding
