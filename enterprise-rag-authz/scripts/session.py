"""Log in as a demo account from a laptop. Needs AWS credentials: the admin flow is the only one
the eval client allows."""

import json
import os
from typing import Any

import boto3

from seed_users import PASSWORDS


def access_token(username: str) -> str:
    return _login(username)["AccessToken"]  # type: ignore[no-any-return]


def _login(username: str) -> dict[str, Any]:
    passwords = json.loads(PASSWORDS.read_text())
    return boto3.client("cognito-idp").admin_initiate_auth(  # type: ignore[no-any-return]
        UserPoolId=os.environ["USER_POOL_ID"],
        ClientId=os.environ["EVAL_CLIENT_ID"],
        AuthFlow="ADMIN_USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": username, "PASSWORD": passwords[username]},
    )["AuthenticationResult"]
