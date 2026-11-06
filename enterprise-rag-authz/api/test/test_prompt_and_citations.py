from erag_api.citations import check_citations, is_not_found
from erag_api.prompt import NOT_FOUND, SYSTEM, build_messages
from erag_api.retrieve import Excerpt

EXCERPTS = [
    Excerpt("a", "Handbook", "", None, "Text a."),
    Excerpt("b", "Policy", "", 3, "Text b."),
]


def test_only_the_question_is_tagged_for_the_guardrail() -> None:
    content = build_messages("my question", EXCERPTS)[0]["content"]
    guarded = [block for block in content if "guardContent" in block]
    assert [block["guardContent"]["text"]["text"] for block in guarded] == ["my question"]
    assert "Text a." not in str(guarded)
    assert "Text a." in content[0]["text"]


def test_the_question_uses_the_qualifier_the_prompt_attack_filter_reads() -> None:
    content = build_messages("my question", EXCERPTS)[0]["content"]
    assert content[1]["guardContent"]["text"]["qualifiers"] == ["guard_content"]


def test_the_delimiter_is_random_for_each_request() -> None:
    first = build_messages("q", EXCERPTS)[0]["content"][0]["text"]
    second = build_messages("q", EXCERPTS)[0]["content"][0]["text"]
    assert first.split(">")[0] != second.split(">")[0]


def test_excerpts_are_numbered_from_one() -> None:
    text = build_messages("q", EXCERPTS)[0]["content"][0]["text"]
    assert '<excerpt id="1">' in text
    assert '<excerpt id="2">' in text


def test_the_system_prompt_holds_the_not_found_sentence() -> None:
    assert NOT_FOUND in SYSTEM


def test_citations_split_valid_from_invalid() -> None:
    check = check_citations("One [1], again [1], two [2], bad [3] and [0].", EXCERPTS)
    assert check.valid == [1, 2]
    assert check.invalid == [0, 3]


def test_no_citations_is_fine() -> None:
    check = check_citations(NOT_FOUND, [])
    assert (check.valid, check.invalid) == ([], [])


def test_a_refusal_with_markers_is_still_a_refusal() -> None:
    answer = f"{NOT_FOUND} [1] [2]"
    assert is_not_found(answer)
    check = check_citations(answer, EXCERPTS)
    assert (check.valid, check.invalid) == ([], [1, 2])


def test_a_partial_answer_is_not_a_refusal() -> None:
    answer = f"Expenses need receipts [1]. {NOT_FOUND}"
    assert not is_not_found(answer)
    assert check_citations(answer, EXCERPTS).valid == [1]


def test_the_prompt_asks_for_partial_answers() -> None:
    assert "answer that part" in SYSTEM.replace("\n", " ")
