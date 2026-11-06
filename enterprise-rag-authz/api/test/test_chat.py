import json
import logging
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from erag.auth.principal import Principal
from erag_api.auth import current_principal
from erag_api.chat import ChatServices, get_chat_services, stream_events
from erag_api.main import app
from erag_api.prompt import NOT_FOUND
from erag_api.usage import LimitExceededError

HR = Principal("user-1", "alderline", frozenset({"hr", "all-staff"}))
ADMIN = Principal("admin-1", "alderline", frozenset({"all-staff", "tenant-admin"}))
NO_GROUPS = Principal("user-2", "alderline", frozenset({"tenant-admin"}))
PRIVATE_QUESTION = "what is the salary of the finance director"


def source(doc_id: str = "doc-1", tenant: str = "alderline") -> dict[str, Any]:
    return {
        "_source": {
            "doc_id": doc_id,
            "tenant_id": tenant,
            "allowed_groups": ["hr"],
            "title": "Salary Bands",
            "heading_path": "Bands",
            "page": None,
            "text": "SECRET-DOCUMENT-TEXT",
        }
    }


def services(
    hits: list[dict[str, Any]], score: float = 0.9, answer: str = "It is 5 [1]."
) -> ChatServices:
    search = MagicMock()
    search.search.return_value = {"hits": {"hits": hits}}
    runtime = MagicMock()
    runtime.invoke_model.side_effect = lambda **_: {
        "body": MagicMock(read=lambda: json.dumps({"embedding": [0.1]}).encode())
    }
    runtime.converse_stream.return_value = {
        "stream": [
            {"contentBlockDelta": {"delta": {"text": answer}}},
            {"messageStop": {"stopReason": "end_turn"}},
            {"metadata": {"usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15}}},
        ]
    }
    agent = MagicMock()
    agent.rerank.side_effect = lambda **kwargs: {
        "results": [
            {"index": index, "relevanceScore": score} for index in range(len(kwargs["sources"]))
        ]
    }
    return ChatServices(
        search=search,
        bedrock_runtime=runtime,
        agent_runtime=agent,
        usage=MagicMock(),
        region="eu-central-1",
        answer_model="model",
        guardrail_id="guardrail",
        guardrail_version="1",
        rerank_min_score=0.1,
    )


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[current_principal] = lambda: HR
    yield TestClient(app)
    app.dependency_overrides.clear()


def ask(client: TestClient, chat_services: ChatServices) -> list[tuple[str, dict[str, Any]]]:
    app.dependency_overrides[get_chat_services] = lambda: chat_services
    response = client.post("/api/chat", json={"question": PRIVATE_QUESTION})
    assert response.status_code == 200
    events = []
    for block in response.text.split("\n\n"):
        lines = block.split("\n")
        if lines[0].startswith("event: "):
            events.append((lines[0].removeprefix("event: "), json.loads(lines[1][6:])))
    return events


def test_events_arrive_in_order(client: TestClient) -> None:
    events = ask(client, services([source()]))
    assert [name for name, _ in events] == ["retrieval", "token", "citations", "done"]
    assert events[1][1]["text"] == "It is 5 [1]."
    assert events[2][1]["citations"][0]["doc_id"] == "doc-1"
    assert events[2][1]["invalid"] == []


def test_retrieved_documents_carry_the_excerpt_for_the_panel(client: TestClient) -> None:
    events = ask(client, services([source()]))
    assert events[0][1]["documents"][0]["text"] == "SECRET-DOCUMENT-TEXT"
    assert events[2][1]["citations"][0]["text"] == "SECRET-DOCUMENT-TEXT"


def test_a_refusal_with_markers_cites_nothing(client: TestClient) -> None:
    events = ask(client, services([source()], answer=f"{NOT_FOUND} [1]"))
    assert events[2][1] == {"citations": [], "invalid": [1], "answered": False}


def test_a_real_answer_is_marked_answered(client: TestClient) -> None:
    assert ask(client, services([source()]))[2][1]["answered"] is True


def test_the_guardrail_and_no_tools_go_to_the_model(client: TestClient) -> None:
    chat_services = services([source()])
    ask(client, chat_services)
    kwargs = chat_services.bedrock_runtime.converse_stream.call_args.kwargs
    assert kwargs["guardrailConfig"]["guardrailIdentifier"] == "guardrail"
    assert kwargs["guardrailConfig"]["streamProcessingMode"] == "sync"
    assert "toolConfig" not in kwargs


def test_an_invalid_marker_is_flagged(client: TestClient) -> None:
    events = ask(client, services([source()], answer="See [1] and [9]."))
    assert events[2][1]["invalid"] == [9]


def test_a_foreign_chunk_never_reaches_the_reranker_or_model(client: TestClient) -> None:
    chat_services = services([source("mine"), source("foreign", tenant="brightmoor")])
    events = ask(client, chat_services)
    sources = chat_services.agent_runtime.rerank.call_args.kwargs["sources"]
    assert len(sources) == 1
    assert events[0][1]["dropped"] == 1
    assert "foreign" not in json.dumps(events)


def test_restricted_and_nonexistent_give_the_same_response(client: TestClient) -> None:
    # Filtered out by OpenSearch, or allowed text that scores below the threshold.
    nothing = ask(client, services([]))
    below = ask(client, services([source()], score=0.01))

    def shape(events: list[tuple[str, dict[str, Any]]]) -> list[tuple[str, dict[str, Any]]]:
        return [(name, data) for name, data in events if name != "done"]

    assert shape(nothing) == shape(below)
    assert [name for name, _ in nothing] == ["retrieval", "token", "citations", "done"]
    assert nothing[1][1] == {"text": NOT_FOUND}
    assert nothing[0][1] == {"documents": [], "dropped": 0}


def test_not_found_never_calls_the_model(client: TestClient) -> None:
    chat_services = services([])
    ask(client, chat_services)
    chat_services.bedrock_runtime.converse_stream.assert_not_called()


def test_a_user_with_no_read_groups_gets_not_found(client: TestClient) -> None:
    app.dependency_overrides[current_principal] = lambda: NO_GROUPS
    chat_services = services([source()])
    events = ask(client, chat_services)
    chat_services.search.search.assert_not_called()
    assert events[1][1] == {"text": NOT_FOUND}


def test_an_admin_with_all_staff_searches_only_as_all_staff(client: TestClient) -> None:
    app.dependency_overrides[current_principal] = lambda: ADMIN
    chat_services = services([])
    ask(client, chat_services)
    body = chat_services.search.search.call_args.kwargs["body"]
    terms = body["query"]["hybrid"]["filter"]["bool"]["filter"][1]["terms"]
    assert terms == {"allowed_groups": ["all-staff"]}


def test_over_the_limit_gets_429_before_any_work(client: TestClient) -> None:
    chat_services = services([source()])
    chat_services.usage.count_question.side_effect = LimitExceededError  # type: ignore[attr-defined]
    app.dependency_overrides[get_chat_services] = lambda: chat_services
    assert client.post("/api/chat", json={"question": "q"}).status_code == 429
    chat_services.search.search.assert_not_called()


@pytest.mark.parametrize("body", [{}, {"question": ""}, {"question": "x" * 2001}])
def test_invalid_questions_are_refused(client: TestClient, body: dict[str, str]) -> None:
    app.dependency_overrides[get_chat_services] = lambda: services([])
    assert client.post("/api/chat", json=body).status_code == 422


def test_tokens_are_counted(client: TestClient) -> None:
    chat_services = services([source()])
    ask(client, chat_services)
    chat_services.usage.count_tokens.assert_called_once_with("user-1", 15)  # type: ignore[attr-defined]


def test_a_failure_sends_a_generic_error_without_details(client: TestClient) -> None:
    chat_services = services([source()])
    chat_services.search.search.side_effect = RuntimeError(f"boom {PRIVATE_QUESTION}")
    events = ask(client, chat_services)
    assert events[-1][0] == "error"
    assert PRIVATE_QUESTION not in json.dumps(events)


def test_audit_lines_hold_no_question_or_document_text(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    logger = logging.getLogger("erag.audit")
    logger.addHandler(caplog.handler)
    try:
        with caplog.at_level(logging.INFO, logger="erag.audit"):
            ask(client, services([source()]))
    finally:
        logger.removeHandler(caplog.handler)
    assert '"question_sha256"' in caplog.text
    assert '"retrieved_doc_ids": ["doc-1"]' in caplog.text
    assert PRIVATE_QUESTION not in caplog.text
    assert "SECRET-DOCUMENT-TEXT" not in caplog.text
    assert "It is 5" not in caplog.text


def test_the_stream_sends_a_heartbeat_while_waiting(monkeypatch: pytest.MonkeyPatch) -> None:
    from threading import Event

    monkeypatch.setattr("erag_api.chat.HEARTBEAT_SECONDS", 0.01)

    release = Event()

    def produce(emit: Any, _stop: Event) -> None:
        release.wait(1)
        emit("done", {})

    stream = stream_events(produce)
    assert next(stream) == ": keepalive\n\n"
    release.set()
    assert "event: done" in "".join(stream)
