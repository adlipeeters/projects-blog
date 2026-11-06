"""Create the demo accounts. Safe to run again. Passwords go to a gitignored file only."""

import contextlib
import json
import os
import secrets
from pathlib import Path

import boto3

from personas import PERSONAS

PASSWORDS = Path(".env.personas.json")


def load_passwords() -> dict[str, str]:
    saved: dict[str, str] = json.loads(PASSWORDS.read_text()) if PASSWORDS.exists() else {}
    for persona in PERSONAS:
        # The fixed prefix meets the pool's character rules whatever the random part holds.
        saved.setdefault(persona.username, f"Aa1-{secrets.token_urlsafe(24)}")
    PASSWORDS.touch(mode=0o600)
    PASSWORDS.write_text(json.dumps(saved, indent=2))
    return saved


def main() -> None:
    pool = os.environ["USER_POOL_ID"]
    cognito = boto3.client("cognito-idp")
    passwords = load_passwords()

    for persona in PERSONAS:
        with contextlib.suppress(cognito.exceptions.UsernameExistsException):
            cognito.admin_create_user(
                UserPoolId=pool,
                Username=persona.username,
                MessageAction="SUPPRESS",
                UserAttributes=[
                    {"Name": "email", "Value": f"{persona.username}@example.com"},
                    {"Name": "custom:tenant_id", "Value": persona.tenant_id},
                ],
            )
        cognito.admin_set_user_password(
            UserPoolId=pool,
            Username=persona.username,
            Password=passwords[persona.username],
            Permanent=True,
        )
        for group in persona.groups:
            cognito.admin_add_user_to_group(
                UserPoolId=pool, Username=persona.username, GroupName=group
            )
        print(f"{persona.username}: {persona.tenant_id}, {sorted(persona.groups)}")


if __name__ == "__main__":
    main()
