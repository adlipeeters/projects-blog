"""Cognito pre token generation trigger, event version V2_0. Deployed as a single file."""

from typing import Any


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    tenant_id = event["request"]["userAttributes"].get("custom:tenant_id")
    if not tenant_id:
        # An account with no tenant can't get a token at all. Raising here fails the login.
        raise ValueError("user has no tenant")

    claims = {"claimsToAddOrOverride": {"tenant_id": tenant_id}}
    event["response"]["claimsAndScopeOverrideDetails"] = {
        "accessTokenGeneration": claims,
        "idTokenGeneration": claims,
    }
    return event
