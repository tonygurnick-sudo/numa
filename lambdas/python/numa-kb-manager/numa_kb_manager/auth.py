"""JWT verification + Cognito user identifier resolution.

Self-contained subset of the chat-agent's auth module — only what the KB
endpoints need (verify a token, swap emails for sub IDs and back).
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

import jwt
import requests
import structlog
from jwt import algorithms

from prm import client as prm_client

from .config import REGION, USER_POOL_CLIENT_ID, USER_POOL_ID

logger = structlog.get_logger()

_jwks_cache: Dict[str, Any] = {"data": None}
_COGNITO_CLIENT: Any = None


def _get_cognito_client() -> Any:
    global _COGNITO_CLIENT  # pylint: disable=global-statement
    if _COGNITO_CLIENT is None:
        _COGNITO_CLIENT = prm_client("cognito-idp", region=REGION)
    return _COGNITO_CLIENT


def _get_jwks() -> Dict[str, Any]:
    if _jwks_cache["data"] is None:
        jwks_url = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
        resp = requests.get(jwks_url, timeout=10)
        resp.raise_for_status()
        _jwks_cache["data"] = resp.json()
    return _jwks_cache["data"]


def verify_jwt_token(token: str) -> Dict[str, Any]:
    """Verify a Cognito-issued ID or access token and return its claims."""
    if token.startswith("Bearer "):
        token = token[7:]

    jwks = _get_jwks()
    unverified = jwt.get_unverified_header(token)
    kid = unverified.get("kid")
    if not kid:
        raise ValueError("Token missing 'kid' header")

    rsa_key = None
    for jwk in jwks.get("keys", []):
        if jwk.get("kid") == kid:
            rsa_key = algorithms.RSAAlgorithm.from_jwk(jwk)
            break
    if not rsa_key:
        raise ValueError("Unable to find matching key")

    payload_check = jwt.decode(
        token,
        rsa_key,  # type: ignore[arg-type]
        algorithms=["RS256"],
        issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
        options={"verify_exp": True, "verify_aud": False},
    )

    token_use = payload_check.get("token_use")
    if token_use == "id":
        payload = jwt.decode(
            token,
            rsa_key,  # type: ignore[arg-type]
            algorithms=["RS256"],
            audience=USER_POOL_CLIENT_ID,
            issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
            options={"verify_exp": True},
        )
    elif token_use == "access":
        if payload_check.get("client_id") != USER_POOL_CLIENT_ID:
            raise ValueError("Invalid client_id")
        payload = payload_check
    else:
        raise ValueError(f"Unknown token_use: {token_use}")

    if not payload.get("sub"):
        raise ValueError("Token missing required 'sub' claim")
    return payload


def _is_email(value: str) -> bool:
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", value))


def _resolve_email_to_sub(email: str, cognito_client: Any) -> Optional[str]:
    try:
        response = cognito_client.list_users(
            UserPoolId=USER_POOL_ID, Filter=f'email = "{email}"', Limit=1
        )
        users = response.get("Users", [])
        if not users:
            logger.warning("Email not found in Cognito", email=email)
            return None

        for attr in users[0].get("Attributes", []):
            if attr.get("Name") == "sub":
                sub_id = attr.get("Value")
                if sub_id:
                    return sub_id

        logger.warning("User found but no sub attribute", email=email)
        return None
    except Exception as e:  # pylint: disable=broad-except
        logger.error("Error resolving email", email=email, error=str(e))
        return None


def resolve_user_identifiers(identifiers: List[str]) -> tuple[List[str], List[str]]:
    """Map a mix of emails / sub IDs to Cognito sub IDs.

    Returns a (resolved, unresolved) tuple. Unknown formats and unmatched
    emails come back as unresolved so the caller can surface them to the user.
    """
    if not identifiers:
        return [], []

    resolved: List[str] = []
    unresolved: List[str] = []
    cognito_client = _get_cognito_client()

    uuid_re = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )

    for raw in identifiers:
        identifier = raw.strip()
        if not identifier:
            continue

        if identifier == "*":
            resolved.append(identifier)
            continue

        if uuid_re.match(identifier.lower()):
            resolved.append(identifier)
            continue

        if _is_email(identifier):
            sub_id = _resolve_email_to_sub(identifier, cognito_client)
            if sub_id:
                resolved.append(sub_id)
            else:
                unresolved.append(identifier)
        else:
            unresolved.append(identifier)

    return resolved, unresolved


def _resolve_sub_to_email(sub_id: str, cognito_client: Any) -> Optional[str]:
    try:
        response = cognito_client.admin_get_user(
            UserPoolId=USER_POOL_ID, Username=sub_id
        )
        for attr in response.get("UserAttributes", []):
            if attr.get("Name") == "email":
                email = attr.get("Value")
                if email:
                    return email
        logger.warning("User found but no email attribute", sub=sub_id)
        return None
    except cognito_client.exceptions.UserNotFoundException:
        logger.warning("User not found in Cognito", sub=sub_id)
        return None
    except Exception as e:  # pylint: disable=broad-except
        logger.error("Error resolving sub to email", sub=sub_id, error=str(e))
        return None


def resolve_subs_to_emails(sub_ids: List[str]) -> List[str]:
    if not sub_ids:
        return []

    cognito_client = _get_cognito_client()
    emails: List[str] = []
    for sub_id in sub_ids:
        if not sub_id or sub_id == "*":
            continue
        email = _resolve_sub_to_email(sub_id, cognito_client)
        if email:
            emails.append(email)
    return emails
