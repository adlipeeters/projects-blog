"""One JSON line per question or admin action. IDs and counts only: a prompt, an answer or a line
of document text in a log would be a second copy with weaker access rules."""

import hashlib
import json
import logging
from typing import Any

logger = logging.getLogger("erag.audit")
logger.setLevel(logging.INFO)
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())
logger.propagate = False


def question_hash(question: str) -> str:
    return hashlib.sha256(question.encode()).hexdigest()


def audit(event: str, **fields: Any) -> None:
    logger.info(json.dumps({"audit": event, **fields}, default=str))
