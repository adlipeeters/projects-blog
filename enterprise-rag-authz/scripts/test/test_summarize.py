from summarize import percentile, summarize


def test_summary_counts_outcomes() -> None:
    summary = summarize(
        [
            {
                "guardrail_action": "NONE",
                "time_to_first_token_ms": 1000,
                "input_tokens": 100,
                "output_tokens": 10,
                "dropped": 0,
            },
            {
                "guardrail_action": "INTERVENED",
                "time_to_first_token_ms": 3000,
                "input_tokens": 300,
                "output_tokens": 30,
                "dropped": 2,
            },
            {"guardrail_action": "NOT_CALLED", "dropped": 0},
            {"error": "RuntimeError", "dropped": 0},
        ]
    )
    assert summary["questions"] == 4
    assert summary["reached_the_model"] == 2
    assert summary["not_found_without_model"] == 1
    assert summary["guardrail_blocked"] == 1
    assert summary["errors"] == 1
    assert summary["chunks_dropped_by_recheck"] == 2
    assert summary["first_token_median_ms"] == 2000
    assert summary["input_tokens_mean"] == 200


def test_summary_of_nothing() -> None:
    assert summarize([])["first_token_median_ms"] is None


def test_percentile() -> None:
    assert percentile(list(range(1, 101)), 0.95) == 96
