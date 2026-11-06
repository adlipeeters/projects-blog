"""The golden questions (spec section 11): 40 answerable and 10 unanswerable, checked with plain
string rules and no LLM judge. Writes every score, so the rerank threshold comes from data."""

import json
import os
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from personas import PERSONAS
from session import access_token

ANSWERABLE = 40
READERS = {
    "hr": "hr",
    "finance": "finance",
    "legal": "legal",
    "engineering": "engineer",
    "general": "engineer",
}
UNANSWERABLE = [
    "What is the airspeed velocity of an unladen swallow?",
    "Who won the football world cup in 1966?",
    "What is the boiling point of tungsten?",
    "How do I bake sourdough bread at home?",
    "What is the capital of Mongolia?",
    "Which moon of Jupiter is the largest?",
    "What is the company's policy on keeping pet llamas in the office?",
    "How many submarines does the company operate?",
    "When is the annual company ski race on Mars?",
    "What is the phone number of the company's lighthouse keeper?",
]


def ask(client: httpx.Client, question: str) -> dict[str, Any]:
    result: dict[str, Any] = {"tokens": ""}
    for _ in range(6):
        with client.stream(
            "POST", "/api/chat", json={"question": question}, timeout=90
        ) as response:
            if response.status_code == 429:
                time.sleep(20)
                continue
            response.raise_for_status()
            name = ""
            for line in response.iter_lines():
                if line.startswith("event: "):
                    name = line.removeprefix("event: ")
                elif line.startswith("data: "):
                    data = json.loads(line.removeprefix("data: "))
                    if name == "token":
                        result["tokens"] += data["text"]
                    else:
                        result[name] = data
            return result
    raise RuntimeError("rate limited after retries")


def reader_for(entry: dict[str, Any]) -> str:
    """Brightmoor has no finance or legal account, so those documents have no reader to ask."""
    return f"{entry['tenant_id']}-{READERS[entry['department']]}"


def normalize(text: str) -> str:
    return " ".join(text.lower().replace("*", "").split())


def main() -> int:
    usernames = {persona.username for persona in PERSONAS}
    entries = [
        entry
        for entry in json.loads(Path("corpus/manifest.json").read_text())
        if not entry["injection"] and reader_for(entry) in usernames
    ]
    sample = entries[:: max(1, len(entries) // ANSWERABLE)][:ANSWERABLE]
    base = os.environ["API_URL"]
    clients: dict[str, httpx.Client] = {}

    def client_for(username: str) -> httpx.Client:
        if username not in clients:
            headers = {"Authorization": f"Bearer {access_token(username)}"}
            clients[username] = httpx.Client(base_url=base, headers=headers, timeout=90)
        return clients[username]

    rows: list[dict[str, Any]] = []
    for entry in sample:
        result = ask(client_for(reader_for(entry)), entry["question"])
        documents = result["retrieval"]["documents"]
        expected = [d["score"] for d in documents if d["title"] == entry["title"]]
        cited = {c["title"] for c in result["citations"]["citations"]}
        rows.append(
            {
                "kind": "answerable",
                "path": entry["path"],
                "hit_at_5": bool(expected),
                "expected_score": max(expected, default=None),
                "top_score": max((d["score"] for d in documents), default=None),
                "fact_in_answer": normalize(entry["fact"]) in normalize(result["tokens"]),
                "cited_expected": entry["title"] in cited,
                "invalid_citations": result["citations"]["invalid"],
                "said_not_found": not result["citations"]["answered"],
                # results/ is gitignored, and this is fictional text from the corpus.
                "fact": entry["fact"],
                "answer": result["tokens"],
            }
        )
        print(rows[-1]["path"], rows[-1]["hit_at_5"], rows[-1]["fact_in_answer"])

    for question in UNANSWERABLE:
        for reader in ("alderline-engineer", "brightmoor-hr"):
            result = ask(client_for(reader), question)
            documents = result["retrieval"]["documents"]
            rows.append(
                {
                    "kind": "unanswerable",
                    "question": question,
                    "reader": reader,
                    "top_score": max((d["score"] for d in documents), default=None),
                    "said_not_found": not result["citations"]["answered"],
                    "model_called": bool(documents),
                }
            )

    answerable = [r for r in rows if r["kind"] == "answerable"]
    unanswerable = [r for r in rows if r["kind"] == "unanswerable"]
    expected_scores = [r["expected_score"] for r in answerable if r["expected_score"] is not None]
    noise_scores = [r["top_score"] for r in unanswerable if r["top_score"] is not None]
    summary = {
        "answerable": len(answerable),
        "hit_at_5": sum(r["hit_at_5"] for r in answerable),
        "fact_in_answer": sum(r["fact_in_answer"] for r in answerable),
        "cited_expected_document": sum(r["cited_expected"] for r in answerable),
        "answers_with_invalid_citation": sum(bool(r["invalid_citations"]) for r in answerable),
        "wrongly_said_not_found": sum(r["said_not_found"] for r in answerable),
        "unanswerable": len(unanswerable),
        "correctly_said_not_found": sum(r["said_not_found"] for r in unanswerable),
        "unanswerable_reached_model": sum(r["model_called"] for r in unanswerable),
        "lowest_expected_score": min(expected_scores, default=None),
        "median_expected_score": statistics.median(expected_scores) if expected_scores else None,
        "highest_noise_score": max(noise_scores, default=None),
    }
    print(json.dumps(summary, indent=2))
    results = Path("results")
    results.mkdir(exist_ok=True)
    path = results / f"quality-{datetime.now(UTC):%Y%m%dT%H%M%S}.json"
    path.write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
