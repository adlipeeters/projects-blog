"""The only place a Principal comes from: a verified Cognito access token. The tenant and groups
are never read from a body, header or query string."""

from collections.abc import Callable
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, HTTPException, status

from erag.auth.principal import Principal
from erag.authz import is_admin
from erag_api.settings import get_settings


class InvalidTokenError(Exception):
    pass


class TokenVerifier:
    def __init__(
        self, issuer: str, client_ids: frozenset[str], signing_key: Callable[[str], Any]
    ) -> None:
        self._issuer = issuer
        self._client_ids = client_ids
        self._signing_key = signing_key

    def verify(self, token: str) -> Principal:
        try:
            claims = jwt.decode(
                token,
                self._signing_key(token),
                algorithms=["RS256"],
                issuer=self._issuer,
                options={"require": ["exp", "iss", "sub"]},
            )
        except (jwt.PyJWTError, ValueError) as error:
            raise InvalidTokenError from error

        if claims.get("token_use") != "access" or claims.get("client_id") not in self._client_ids:
            raise InvalidTokenError
        tenant_id = claims.get("tenant_id")
        groups = claims.get("cognito:groups", [])
        if not isinstance(tenant_id, str) or not tenant_id or not isinstance(groups, list):
            raise InvalidTokenError
        return Principal(sub=claims["sub"], tenant_id=tenant_id, groups=frozenset(groups))


@lru_cache(maxsize=1)
def get_verifier() -> TokenVerifier:
    settings = get_settings()
    keys = jwt.PyJWKClient(f"{settings.issuer}/.well-known/jwks.json", cache_keys=True)
    return TokenVerifier(
        settings.issuer,
        settings.client_ids,
        lambda token: keys.get_signing_key_from_jwt(token).key,
    )


def current_principal(
    verifier: Annotated[TokenVerifier, Depends(get_verifier)],
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing token")
    try:
        return verifier.verify(token)
    except InvalidTokenError as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from error


def require_admin(principal: Annotated[Principal, Depends(current_principal)]) -> Principal:
    if not is_admin(principal):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admins only")
    return principal
