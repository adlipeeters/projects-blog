"""Log in as every persona and check what the access token says. This reads the claims without
verifying the signature, which is fine for a check of what Cognito issued. The API verifies it."""

import base64
import json
import os
import sys
from typing import Any

import boto3
from botocore.exceptions import ClientError

from personas import PERSONAS, Persona
from seed_users import PASSWORDS


def claims(token: str) -> dict[str, Any]:
    payload = token.split(".")[1]
    decoded: dict[str, Any] = json.loads(
        base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
    )
    return decoded


def problems(persona: Persona, access_claims: dict[str, Any]) -> list[str]:
    found = []
    if access_claims.get("token_use") != "access":
        found.append("not an access token")
    if access_claims.get("tenant_id") != persona.tenant_id:
        found.append(f"tenant is {access_claims.get('tenant_id')}")
    if frozenset(access_claims.get("cognito:groups", [])) != persona.groups:
        found.append(f"groups are {access_claims.get('cognito:groups')}")
    return found


def can_change_tenant(cognito: Any, access_token: str) -> bool:
    try:
        cognito.update_user_attributes(
            AccessToken=access_token,
            UserAttributes=[{"Name": "custom:tenant_id", "Value": "brightmoor"}],
        )
    except ClientError:
        return False
    return True


def main() -> int:
    pool = os.environ["USER_POOL_ID"]
    client_id = os.environ["EVAL_CLIENT_ID"]
    cognito = boto3.client("cognito-idp")
    passwords = json.loads(PASSWORDS.read_text())
    failed = False

    for persona in PERSONAS:
        result = cognito.admin_initiate_auth(
            UserPoolId=pool,
            ClientId=client_id,
            AuthFlow="ADMIN_USER_PASSWORD_AUTH",
            AuthParameters={
                "USERNAME": persona.username,
                "PASSWORD": passwords[persona.username],
            },
        )["AuthenticationResult"]
        found = problems(persona, claims(result["AccessToken"]))
        if can_change_tenant(cognito, result["AccessToken"]):
            found.append("user changed their own tenant")
        failed = failed or bool(found)
        print(f"{persona.username}: {'; '.join(found) or 'ok'}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
