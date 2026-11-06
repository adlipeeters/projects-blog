"""Time to first token, tokens and outcomes from the audit records of a test run. No prompts or
answers are in those records, so this can run against the real log group."""

import json
import os
import statistics
import sys
import time
from typing import Any

import boto3


def percentile(values: list[int], share: float) -> int:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * share))]


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    answered = [r for r in records if "time_to_first_token_ms" in r]
    first_token = [r["time_to_first_token_ms"] for r in answered]
    inputs = [r.get("input_tokens", 0) for r in answered]
    outputs = [r.get("output_tokens", 0) for r in answered]
    return {
        "questions": len(records),
        "reached_the_model": len(answered),
        "not_found_without_model": sum(r.get("guardrail_action") == "NOT_CALLED" for r in records),
        "guardrail_blocked": sum(r.get("guardrail_action") == "INTERVENED" for r in records),
        "errors": sum("error" in r for r in records),
        "chunks_dropped_by_recheck": sum(r.get("dropped", 0) for r in records),
        "first_token_median_ms": int(statistics.median(first_token)) if first_token else None,
        "first_token_p95_ms": percentile(first_token, 0.95) if first_token else None,
        "input_tokens_mean": int(statistics.mean(inputs)) if inputs else None,
        "output_tokens_mean": int(statistics.mean(outputs)) if outputs else None,
    }


def main() -> int:
    hours = float(sys.argv[1]) if len(sys.argv) > 1 else 24
    pages = (
        boto3.client("logs")
        .get_paginator("filter_log_events")
        .paginate(
            logGroupName=os.environ["API_LOG_GROUP"],
            filterPattern='{ $.audit = "question" }',
            startTime=int((time.time() - hours * 3600) * 1000),
        )
    )
    records = [
        record
        for page in pages
        for record in (json.loads(event["message"]) for event in page["events"])
        # The proof's deliberate drops aren't traffic.
        if record.get("source") != "recheck-proof"
    ]
    print(json.dumps(summarize(records), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
