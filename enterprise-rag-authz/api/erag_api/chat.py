"""POST /api/chat: the question path, streamed over SSE (spec sections 8 and 9)."""

import json
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from functools import lru_cache
from queue import Empty, Queue
from threading import Event, Thread
from typing import Annotated, Any

import boto3
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from erag.auth.principal import Principal
from erag.retrieval.client import make_client
from erag_api.audit import audit, question_hash
from erag_api.auth import current_principal
from erag_api.citations import check_citations, is_not_found
from erag_api.prompt import NOT_FOUND, SYSTEM, build_messages
from erag_api.retrieve import Excerpt, rerank, retrieve
from erag_api.settings import get_settings
from erag_api.usage import LimitExceededError, UsageTracker

HEARTBEAT_SECONDS = 15

router = APIRouter()
Emit = Callable[[str, dict[str, Any]], None]


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


@dataclass(frozen=True)
class ChatServices:
    search: Any
    bedrock_runtime: Any
    agent_runtime: Any
    usage: UsageTracker
    region: str
    answer_model: str
    guardrail_id: str
    guardrail_version: str
    rerank_min_score: float


@lru_cache(maxsize=1)
def get_chat_services() -> ChatServices:
    settings = get_settings()
    return ChatServices(
        search=make_client(settings.search_endpoint, settings.region),
        bedrock_runtime=boto3.client("bedrock-runtime", region_name=settings.region),
        agent_runtime=boto3.client("bedrock-agent-runtime", region_name=settings.region),
        usage=UsageTracker(boto3.resource("dynamodb").Table(settings.registry_table)),
        region=settings.region,
        answer_model=settings.answer_model,
        guardrail_id=settings.guardrail_id,
        guardrail_version=settings.guardrail_version,
        rerank_min_score=settings.rerank_min_score,
    )


@lru_cache(maxsize=1)
def get_usage() -> UsageTracker:
    return UsageTracker(boto3.resource("dynamodb").Table(get_settings().registry_table))


@router.post("/api/chat")
def chat(
    body: Question,
    principal: Annotated[Principal, Depends(current_principal)],
    services: Annotated[ChatServices, Depends(get_chat_services)],
) -> StreamingResponse:
    try:
        services.usage.count_question(principal.sub)
    except LimitExceededError as error:
        audit("rate_limited", sub=principal.sub, tenant=principal.tenant_id)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "usage limit reached") from error

    def produce(emit: Emit, stop: Event) -> None:
        answer_question(services, principal, body.question, emit, stop)

    return StreamingResponse(
        stream_events(produce),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store"},
    )


def answer_question(
    services: ChatServices, principal: Principal, question: str, emit: Emit, stop: Event
) -> None:
    request_id = uuid.uuid4().hex
    started = time.monotonic()
    record: dict[str, Any] = {
        "request_id": request_id,
        "sub": principal.sub,
        "tenant": principal.tenant_id,
        "groups": sorted(principal.groups),
        "question_sha256": question_hash(question),
        "model": services.answer_model,
        "retrieved_doc_ids": [],
        "dropped": 0,
        "dropped_doc_ids": [],
        "cited_doc_ids": [],
    }
    try:
        found = retrieve(services.search, services.bedrock_runtime, principal, question)
        record["dropped"] = found.dropped
        record["dropped_doc_ids"] = found.dropped_doc_ids
        excerpts = rerank(
            services.agent_runtime,
            services.region,
            question,
            found.excerpts,
            services.rerank_min_score,
        )
        record["retrieved_doc_ids"] = sorted({excerpt.doc_id for excerpt in excerpts})
        emit(
            "retrieval",
            {
                "documents": [_document(number, e) for number, e in _numbered(excerpts)],
                "dropped": found.dropped,
            },
        )
        answer = _generate(services, question, excerpts, emit, stop, record, started)
        check = check_citations(answer, excerpts)
        cited = [excerpts[marker - 1] for marker in check.valid]
        record["cited_doc_ids"] = sorted({excerpt.doc_id for excerpt in cited})
        record["invalid_citations"] = check.invalid
        record["answered"] = not is_not_found(answer)
        emit(
            "citations",
            {
                "citations": [_document(marker, excerpts[marker - 1]) for marker in check.valid],
                "invalid": check.invalid,
                "answered": not is_not_found(answer),
            },
        )
        emit("done", {"request_id": request_id})
    except Exception as error:
        record["error"] = type(error).__name__
        # No exception text: it can quote a request, and so a question or a document.
        emit("error", {"message": "the question could not be answered", "request_id": request_id})
    finally:
        record["latency_ms"] = int((time.monotonic() - started) * 1000)
        audit("question", **record)


def _generate(
    services: ChatServices,
    question: str,
    excerpts: list[Excerpt],
    emit: Emit,
    stop: Event,
    record: dict[str, Any],
    started: float,
) -> str:
    """The same path for "doesn't exist" and "you can't read it": no excerpts, no model call."""
    if not excerpts:
        record["guardrail_action"] = "NOT_CALLED"
        emit("token", {"text": NOT_FOUND})
        return NOT_FOUND

    response = services.bedrock_runtime.converse_stream(
        modelId=services.answer_model,
        system=[{"text": SYSTEM}],
        messages=build_messages(question, excerpts),
        inferenceConfig={"temperature": 0, "maxTokens": 800},
        guardrailConfig={
            "guardrailIdentifier": services.guardrail_id,
            "guardrailVersion": services.guardrail_version,
            "streamProcessingMode": "sync",
        },
    )
    parts: list[str] = []
    for event in response["stream"]:
        if stop.is_set():
            break
        text = event.get("contentBlockDelta", {}).get("delta", {}).get("text")
        if text:
            if not parts:
                record["time_to_first_token_ms"] = int((time.monotonic() - started) * 1000)
            parts.append(text)
            emit("token", {"text": text})
        if "messageStop" in event:
            stop_reason = event["messageStop"].get("stopReason")
            record["stop_reason"] = stop_reason
            record["guardrail_action"] = (
                "INTERVENED" if stop_reason == "guardrail_intervened" else "NONE"
            )
        if "metadata" in event:
            usage = event["metadata"].get("usage", {})
            record["input_tokens"] = usage.get("inputTokens", 0)
            record["output_tokens"] = usage.get("outputTokens", 0)
            services.usage.count_tokens(record["sub"], usage.get("totalTokens", 0))
    return "".join(parts)


def stream_events(produce: Callable[[Emit, Event], None]) -> Iterator[str]:
    """Runs the work on a thread so a comment can go out every 15 s while Bedrock is thinking.
    CloudFront and the ALB then never see an idle connection."""
    queue: Queue[str | None] = Queue()
    stop = Event()

    def emit(name: str, data: dict[str, Any]) -> None:
        queue.put(f"event: {name}\ndata: {json.dumps(data)}\n\n")

    def run() -> None:
        try:
            produce(emit, stop)
        finally:
            queue.put(None)

    Thread(target=run, daemon=True).start()
    try:
        while True:
            try:
                item = queue.get(timeout=HEARTBEAT_SECONDS)
            except Empty:
                yield ": keepalive\n\n"
                continue
            if item is None:
                return
            yield item
    finally:
        stop.set()


def _numbered(excerpts: list[Excerpt]) -> list[tuple[int, Excerpt]]:
    return list(enumerate(excerpts, start=1))


def _document(number: int, excerpt: Excerpt) -> dict[str, Any]:
    return {
        "number": number,
        "doc_id": excerpt.doc_id,
        "title": excerpt.title,
        "heading_path": excerpt.heading_path,
        "page": excerpt.page,
        "score": round(excerpt.score, 4),
        # Past the filter and the recheck, so this user may read it. It never goes in the audit log.
        "text": excerpt.text,
    }
