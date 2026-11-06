"""Logs hold no document text, and the per-user limit holds across API tasks."""

import os
import time
from collections.abc import Callable

import boto3
import httpx

ClientFor = Callable[[str], httpx.Client]


def test_the_eleventh_question_in_a_minute_is_refused(client_for: ClientFor) -> None:
    client = client_for("brightmoor-admin")
    # Starts a fresh minute, so earlier tests can't have used part of this one.
    time.sleep(61 - time.time() % 60)
    statuses = [
        client.post("/api/chat", json={"question": f"ping {n}"}, timeout=90).status_code
        for n in range(11)
    ]
    assert statuses[:10] == [200] * 10
    assert statuses[10] == 429


def test_no_canary_appears_in_any_log() -> None:
    logs = boto3.client("logs")
    groups = [
        os.environ["API_LOG_GROUP"],
        os.environ["INGEST_LOG_GROUP"],
        os.environ["PRE_TOKEN_LOG_GROUP"],
    ]
    since = int((time.time() - 24 * 3600) * 1000)
    for group in groups:
        paginator = logs.get_paginator("filter_log_events")
        pages = paginator.paginate(logGroupName=group, filterPattern='"CNRY-"', startTime=since)
        hits = [event for page in pages for event in page["events"]]
        assert hits == [], f"{group}: {len(hits)} log lines hold a canary"


def test_no_question_text_appears_in_the_audit_log() -> None:
    logs = boto3.client("logs")
    since = int((time.time() - 24 * 3600) * 1000)
    pages = logs.get_paginator("filter_log_events").paginate(
        logGroupName=os.environ["API_LOG_GROUP"],
        filterPattern='"internal reference code"',
        startTime=since,
    )
    assert [event for page in pages for event in page["events"]] == []
