"""Attempts to claim another company or group. Only the verified token may decide (section 4)."""

import base64
import json
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import boto3
import httpx
import pytest
from botocore.exceptions import ClientError

from conftest import ask
from session import access_token

ClientFor = Callable[[str], httpx.Client]
MANIFEST: list[dict[str, Any]] = json.loads(Path("corpus/manifest.json").read_text())
SALARY = next(
    e for e in MANIFEST if e["tenant_id"] == "alderline" and e["title"] == "Salary Bands 2026"
)


def _b64(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def forged_token(signature: str = "") -> str:
    claims = {
        "sub": "attacker",
        "iss": "https://cognito-idp.eu-central-1.amazonaws.com/" + os.environ["USER_POOL_ID"],
        "exp": int(time.time()) + 3600,
        "token_use": "access",
        "client_id": os.environ["EVAL_CLIENT_ID"],
        "tenant_id": "alderline",
        "cognito:groups": ["hr", "all-staff"],
    }
    return f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64(claims)}.{signature}"


@pytest.mark.parametrize(
    "extra",
    [
        {"json": {"tenant_id": "alderline", "groups": ["hr"], "allowed_groups": ["hr"]}},
        {"headers": {"X-Tenant-Id": "alderline", "X-Groups": "hr"}},
        {"params": {"tenant_id": "alderline", "groups": "hr"}},
    ],
    ids=["body", "headers", "query"],
)
def test_request_data_cannot_change_who_you_are(
    client_for: ClientFor, extra: dict[str, Any]
) -> None:
    client = client_for("brightmoor-engineer")
    body = {"question": SALARY["canary_question"], **extra.get("json", {})}
    response = client.post(
        "/api/chat",
        json=body,
        headers=extra.get("headers", {}),
        params=extra.get("params", {}),
        timeout=90,
    )
    assert response.status_code == 200
    assert SALARY["canary"] not in response.text


@pytest.mark.parametrize("signature", ["", "AAAA"], ids=["unsigned", "fake-signature"])
def test_a_forged_token_is_refused(api_url: str, signature: str) -> None:
    response = httpx.post(
        f"{api_url}/api/chat",
        headers={"Authorization": f"Bearer {forged_token(signature)}"},
        json={"question": SALARY["canary_question"]},
        timeout=30,
    )
    assert response.status_code == 401
    assert SALARY["canary"] not in response.text


def test_an_id_token_is_refused(api_url: str) -> None:
    client = boto3.client("cognito-idp")
    passwords = json.loads(Path(".env.personas.json").read_text())
    result = client.admin_initiate_auth(
        UserPoolId=os.environ["USER_POOL_ID"],
        ClientId=os.environ["EVAL_CLIENT_ID"],
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": "alderline-hr", "PASSWORD": passwords["alderline-hr"]},
    )["AuthenticationResult"]
    response = httpx.get(
        f"{api_url}/api/me", headers={"Authorization": f"Bearer {result['IdToken']}"}, timeout=30
    )
    assert response.status_code == 401


def test_a_user_cannot_change_their_own_tenant() -> None:
    client = boto3.client("cognito-idp")
    with pytest.raises(ClientError, match=r"NotAuthorized|unauthorized attribute"):
        client.update_user_attributes(
            AccessToken=access_token("brightmoor-engineer"),
            UserAttributes=[{"Name": "custom:tenant_id", "Value": "alderline"}],
        )


def test_the_token_still_decides_after_that_attempt(client_for: ClientFor) -> None:
    result = ask(client_for("brightmoor-engineer"), SALARY["canary_question"])
    assert SALARY["canary"] not in json.dumps(result)
