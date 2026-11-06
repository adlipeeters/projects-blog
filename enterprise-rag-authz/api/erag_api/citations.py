import re
from dataclasses import dataclass

from erag_api.prompt import NOT_FOUND
from erag_api.retrieve import Excerpt

_MARKER = re.compile(r"\[(\d+)\]")


@dataclass(frozen=True)
class CitationCheck:
    valid: list[int]
    invalid: list[int]


def is_not_found(answer: str) -> bool:
    """The model sometimes adds markers to the refusal, which would read as a cited refusal."""
    return _MARKER.sub("", answer).strip() == NOT_FOUND


def check_citations(answer: str, excerpts: list[Excerpt]) -> CitationCheck:
    """Only authorized chunks reach the model, so a bad marker is a quality problem, not a leak."""
    markers = sorted({int(marker) for marker in _MARKER.findall(answer)})
    if is_not_found(answer):
        return CitationCheck(valid=[], invalid=markers)
    return CitationCheck(
        valid=[marker for marker in markers if 1 <= marker <= len(excerpts)],
        invalid=[marker for marker in markers if not 1 <= marker <= len(excerpts)],
    )
