from typing import Any

import pytest

from pre_token import handler


def event(attributes: dict[str, str]) -> dict[str, Any]:
    return {"request": {"userAttributes": attributes}, "response": {}}


def test_pre_token_puts_the_tenant_in_both_tokens() -> None:
    result = handler(event({"custom:tenant_id": "alderline"}), None)
    details = result["response"]["claimsAndScopeOverrideDetails"]
    expected = {"claimsToAddOrOverride": {"tenant_id": "alderline"}}
    assert details == {"accessTokenGeneration": expected, "idTokenGeneration": expected}


@pytest.mark.parametrize("attributes", [{}, {"custom:tenant_id": ""}])
def test_pre_token_fails_the_login_without_a_tenant(attributes: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        handler(event(attributes), None)
