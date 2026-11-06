"""Per-user limits in DynamoDB. Two API tasks serve one user, so the counters have to be shared."""

import time
from datetime import UTC, datetime
from typing import Any

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

QUESTIONS_PER_MINUTE = 10
QUESTIONS_PER_DAY = 200
TOKENS_PER_DAY = 200_000

_MINUTE_TTL_SECONDS = 300
_DAY_TTL_SECONDS = 3 * 86_400


class LimitExceededError(Exception):
    pass


class UsageTracker:
    def __init__(self, table: Any) -> None:
        self._table = table

    def count_question(self, sub: str, now: datetime | None = None) -> None:
        moment = now or datetime.now(UTC)
        self._increment(
            sub, f"MIN#{moment:%Y-%m-%dT%H:%M}", QUESTIONS_PER_MINUTE, _MINUTE_TTL_SECONDS
        )
        self._increment(sub, _day_key(moment), QUESTIONS_PER_DAY, _DAY_TTL_SECONDS)
        item = self._table.get_item(Key=_key(sub, _day_key(moment))).get("Item", {})
        if int(item.get("tokens", 0)) >= TOKENS_PER_DAY:
            raise LimitExceededError

    def count_tokens(self, sub: str, tokens: int, now: datetime | None = None) -> None:
        moment = now or datetime.now(UTC)
        self._table.update_item(
            Key=_key(sub, _day_key(moment)),
            UpdateExpression="ADD tokens :tokens",
            ExpressionAttributeValues={":tokens": tokens},
        )

    def remaining(self, sub: str, now: datetime | None = None) -> dict[str, int]:
        moment = now or datetime.now(UTC)
        item = self._table.get_item(Key=_key(sub, _day_key(moment))).get("Item", {})
        return {
            "questions_left_today": max(0, QUESTIONS_PER_DAY - int(item.get("questions", 0))),
            "tokens_left_today": max(0, TOKENS_PER_DAY - int(item.get("tokens", 0))),
        }

    def _increment(self, sub: str, sort_key: str, limit: int, ttl_seconds: int) -> None:
        try:
            self._table.update_item(
                Key=_key(sub, sort_key),
                UpdateExpression="ADD questions :one SET #ttl = if_not_exists(#ttl, :ttl)",
                ConditionExpression=Attr("questions").not_exists() | Attr("questions").lt(limit),
                ExpressionAttributeNames={"#ttl": "ttl"},
                ExpressionAttributeValues={":one": 1, ":ttl": int(time.time()) + ttl_seconds},
            )
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise LimitExceededError from error
            raise


def _key(sub: str, sort_key: str) -> dict[str, str]:
    return {"PK": f"USER#{sub}", "SK": sort_key}


def _day_key(moment: datetime) -> str:
    return f"DAY#{moment:%Y-%m-%d}"
