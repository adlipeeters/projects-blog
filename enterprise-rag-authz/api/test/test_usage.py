from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import boto3
import pytest
from moto import mock_aws

from erag_api.usage import (
    QUESTIONS_PER_DAY,
    QUESTIONS_PER_MINUTE,
    TOKENS_PER_DAY,
    LimitExceededError,
    UsageTracker,
)

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)


@pytest.fixture
def usage() -> Iterator[UsageTracker]:
    with mock_aws():
        table = boto3.resource("dynamodb", region_name="eu-central-1").create_table(
            TableName="registry",
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
        )
        yield UsageTracker(table)


def test_the_eleventh_question_in_a_minute_is_refused(usage: UsageTracker) -> None:
    for _ in range(QUESTIONS_PER_MINUTE):
        usage.count_question("user-1", NOW)
    with pytest.raises(LimitExceededError):
        usage.count_question("user-1", NOW)


def test_the_next_minute_starts_fresh(usage: UsageTracker) -> None:
    for _ in range(QUESTIONS_PER_MINUTE):
        usage.count_question("user-1", NOW)
    usage.count_question("user-1", NOW + timedelta(minutes=1))


def test_limits_are_per_user(usage: UsageTracker) -> None:
    for _ in range(QUESTIONS_PER_MINUTE):
        usage.count_question("user-1", NOW)
    usage.count_question("user-2", NOW)


def test_the_daily_question_limit_applies_across_minutes(usage: UsageTracker) -> None:
    for minute in range(QUESTIONS_PER_DAY):
        usage.count_question("user-1", NOW + timedelta(seconds=minute * 7))
    with pytest.raises(LimitExceededError):
        usage.count_question("user-1", NOW + timedelta(minutes=30))


def test_spent_tokens_block_the_next_question(usage: UsageTracker) -> None:
    usage.count_question("user-1", NOW)
    usage.count_tokens("user-1", TOKENS_PER_DAY, NOW)
    with pytest.raises(LimitExceededError):
        usage.count_question("user-1", NOW + timedelta(minutes=1))


def test_remaining_counts_down(usage: UsageTracker) -> None:
    assert usage.remaining("user-1", NOW)["questions_left_today"] == QUESTIONS_PER_DAY
    usage.count_question("user-1", NOW)
    usage.count_tokens("user-1", 100, NOW)
    assert usage.remaining("user-1", NOW) == {
        "questions_left_today": QUESTIONS_PER_DAY - 1,
        "tokens_left_today": TOKENS_PER_DAY - 100,
    }
