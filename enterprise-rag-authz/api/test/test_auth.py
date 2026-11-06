import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from erag_api.auth import InvalidTokenError, TokenVerifier

ISSUER = "https://cognito-idp.eu-central-1.amazonaws.com/pool"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
VERIFIER = TokenVerifier(ISSUER, frozenset({"web"}), lambda _token: KEY.public_key())


def token(key: Any = KEY, algorithm: str = "RS256", **overrides: Any) -> str:
    claims: dict[str, Any] = {
        "sub": "user-1",
        "iss": ISSUER,
        "exp": time.time() + 60,
        "token_use": "access",
        "client_id": "web",
        "tenant_id": "alderline",
        "cognito:groups": ["hr", "all-staff"],
        **overrides,
    }
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm)


def test_a_good_token_gives_a_principal() -> None:
    principal = VERIFIER.verify(token())
    assert principal.sub == "user-1"
    assert principal.tenant_id == "alderline"
    assert principal.groups == {"hr", "all-staff"}


def test_a_user_with_no_groups_is_still_valid() -> None:
    no_groups: dict[str, Any] = {"cognito:groups": None}
    assert VERIFIER.verify(token(**no_groups)).groups == frozenset()


@pytest.mark.parametrize(
    "bad",
    [
        {"exp": time.time() - 60},
        {"iss": "https://example.com/other"},
        {"token_use": "id"},
        {"client_id": "other-client"},
        {"tenant_id": None},
        {"tenant_id": ""},
        {"tenant_id": 7},
        {"cognito:groups": "hr"},
        {"sub": None},
    ],
)
def test_bad_claims_are_rejected(bad: dict[str, Any]) -> None:
    with pytest.raises(InvalidTokenError):
        VERIFIER.verify(token(**bad))


def test_a_token_signed_by_another_key_is_rejected() -> None:
    with pytest.raises(InvalidTokenError):
        VERIFIER.verify(token(key=OTHER_KEY))


def test_an_unsigned_token_is_rejected() -> None:
    with pytest.raises(InvalidTokenError):
        VERIFIER.verify(token(key=None, algorithm="none"))


def test_junk_is_rejected() -> None:
    with pytest.raises(InvalidTokenError):
        VERIFIER.verify("not.a.token")
