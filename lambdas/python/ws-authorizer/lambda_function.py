"""
WebSocket Lambda Authorizer
Validates Cognito JWT tokens from query parameters for WebSocket connections
"""

import os
from typing import Any, Dict, Optional

import jwt
import requests
import structlog
from jwt import algorithms

logger = structlog.get_logger()

# Environment variables
USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID")
USER_POOL_CLIENT_ID = os.environ.get("COGNITO_USER_POOL_CLIENT_ID")
REGION = os.environ.get("AWS_REGION", "us-east-1")

# Cache for JWKS (JSON Web Key Set)
_jwks_cache = {"data": None}


def get_jwks():
    """Get JWKS from Cognito, with caching"""
    if _jwks_cache["data"] is None:
        jwks_url = (
            f"https://cognito-idp.{REGION}.amazonaws.com/"
            f"{USER_POOL_ID}/.well-known/jwks.json"
        )
        try:
            response = requests.get(jwks_url, timeout=10)
            response.raise_for_status()
            _jwks_cache["data"] = response.json()
            logger.info("JWKS loaded successfully")
        except (requests.RequestException, requests.HTTPError) as exc:
            logger.error("Failed to load JWKS", error=str(exc))
            raise
    return _jwks_cache["data"]


def verify_jwt_token(token: str) -> Dict[str, Any]:
    """Verify JWT token against Cognito JWKS"""
    try:
        # Remove 'Bearer ' prefix if present
        if token.startswith("Bearer "):
            token = token[7:]

        # Get JWKS
        jwks = get_jwks()

        # Decode token header to get key ID
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        if not kid:
            raise ValueError("Token missing 'kid' in header")

        # Find the matching key
        rsa_key = None
        for jwk in jwks.get("keys", []):
            if jwk.get("kid") == kid:
                rsa_key = algorithms.RSAAlgorithm.from_jwk(jwk)
                break

        if not rsa_key:
            raise ValueError(f"Unable to find matching key for kid: {kid}")

        # First, decode without audience verification to check token type
        payload_check = jwt.decode(
            token,
            rsa_key,  # type: ignore
            algorithms=["RS256"],
            issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
            options={"verify_exp": True, "verify_aud": False},
        )

        # Determine if this is an ID token or access token
        token_use = payload_check.get("token_use")

        if token_use == "id":
            # For ID tokens, verify audience
            payload = jwt.decode(
                token,
                rsa_key,  # type: ignore
                algorithms=["RS256"],
                audience=USER_POOL_CLIENT_ID,
                issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
                options={"verify_exp": True},
            )
        elif token_use == "access":
            # For access tokens, verify client_id instead of audience
            if payload_check.get("client_id") != USER_POOL_CLIENT_ID:
                raise ValueError(f"Invalid client_id: {payload_check.get('client_id')}")
            payload = payload_check
        else:
            raise ValueError(f"Unknown token_use: {token_use}")

        # Validate required claims
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Token missing required 'sub' claim")

        logger.info("Token verified successfully", sub=user_id)
        return payload

    except jwt.ExpiredSignatureError as exc:
        logger.warning("Token has expired")
        raise ValueError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        logger.warning("Invalid token", error=str(exc))
        raise ValueError(f"Invalid token: {str(exc)}") from exc
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        logger.error("Token verification failed", error=str(exc))
        raise ValueError(f"Token verification failed: {str(exc)}") from exc


def generate_policy(
    principal_id: str,
    effect: str,
    resource: str,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Generate IAM policy for API Gateway"""
    policy = {
        "principalId": principal_id,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {"Action": "execute-api:Invoke", "Effect": effect, "Resource": resource}
            ],
        },
    }

    if context:
        policy["context"] = context

    return policy


def handler(event, _):
    """WebSocket Lambda Authorizer handler"""
    try:
        logger.info("Authorizer invoked", event_keys=list(event.keys()))

        # Extract token from query parameters
        query_params = event.get("queryStringParameters") or {}
        token = query_params.get("Authorization")

        if not token:
            logger.warning("No authorization token provided")
            raise ValueError("No authorization token provided")

        # Verify the JWT token
        payload = verify_jwt_token(token)

        if not payload or not isinstance(payload, dict):
            logger.error("JWT verification failed - invalid payload")
            raise ValueError("JWT verification failed")

        user_id = payload.get("sub")
        if not user_id:
            logger.error("JWT verification failed - missing required 'sub' claim")
            raise ValueError("Missing required user ID")
        email = payload.get("email")
        groups = payload.get("cognito:groups", [])

        # Create context to pass to the Lambda function
        auth_context = {
            "sub": user_id,
            "email": email or "",
            "groups": ",".join(groups) if groups else "",
            "token_use": payload.get("token_use", ""),
        }

        logger.info(
            "Authorization successful", user_id=user_id, email=email, groups=groups
        )

        # Return allow policy with user context
        return generate_policy(user_id, "Allow", event["methodArn"], auth_context)

    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        logger.error("Authorizer error", error=str(exc), exc_info=True)
        raise exc  # Let API Gateway handle the denial
