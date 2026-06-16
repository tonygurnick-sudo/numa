"""
Security validation for the Numa Standard Model relay.

Validates cross-account callers (the per-tenant AgentCore workspace container)
using an STS presigned GetCallerIdentity URL passed in the ``x-numa-sts-proof``
header. Ported from ``numa-email-sender/security_validator.py`` with two
deliberate differences:

  1. The proof is carried in a request *header* (not a JSON body field), and is
     validated **before** the upstream model stream is opened.
  2. The freshness window is relaxed to 120-300 s (vs the email sender's 60 s),
     because the in-container proxy mints the proof per request and a streaming
     turn can take longer to start than a one-shot email send (contracts.md §2).

Only the AgentCore runtime execution role is allowed:
``numa-{clientName}-workspace-chat-agentcore`` (contracts.md §3). The caller
account must additionally exist in ``numa-client-config``.
"""

import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

import structlog

from prm import resource as prm_resource

logger = structlog.get_logger()

# Only the AgentCore workspace runtime role may reach the relay.
# Matches: numa-{clientName}-workspace-chat-agentcore  (contracts.md §3,
# confirmed at workspace-chat-agent-construct.ts:299).
ALLOWED_ROLE_REGEX = re.compile(r"^numa-[a-zA-Z0-9-]+-workspace-chat-agentcore$")

# SSRF prevention: only AWS STS regional endpoints may be fetched server-side.
# Mirrors the email-sender allowlist plus Jakarta (Nolia data region). The
# contract specifies the pattern ``sts.*.amazonaws.com``; we keep it to a hard
# allowlist of the regions Numa actually deploys to rather than a wildcard.
ALLOWED_STS_HOSTS = {
    "sts.us-east-1.amazonaws.com",
    "sts.ap-southeast-2.amazonaws.com",
    "sts.ap-southeast-3.amazonaws.com",
}

# Relaxed freshness bounds for the relay (vs email-sender's 60 s).
MAX_PROOF_EXPIRES_SECONDS = 300
MAX_PROOF_AGE_SECONDS = 300


class SecurityValidationError(Exception):
    """Raised when security validation fails."""


def _log_body_snippet(body: bytes, max_length: int = 200) -> str:
    return body[:max_length].decode("utf-8", "replace")


class RelaySecurityValidator:
    """Validates cross-account relay requests using STS proof URLs."""

    def __init__(self) -> None:
        self.dynamodb = prm_resource("dynamodb")
        self.client_config_table_name = os.environ.get("CLIENT_CONFIG_TABLE_NAME")
        if not self.client_config_table_name:
            raise ValueError("CLIENT_CONFIG_TABLE_NAME environment variable not set")
        self.client_config_table = self.dynamodb.Table(self.client_config_table_name)

    def validate_request(self, sts_proof_url: str) -> Dict[str, Any]:
        """
        Validate an incoming relay request.

        Args:
            sts_proof_url: STS presigned GetCallerIdentity URL from the caller
                (the ``x-numa-sts-proof`` header value).

        Returns:
            Dict with caller_account_id and role_name on success.

        Raises:
            SecurityValidationError: If validation fails.
        """
        try:
            if not sts_proof_url or not isinstance(sts_proof_url, str):
                raise SecurityValidationError("Missing STS proof")

            self._validate_sts_url_freshness(sts_proof_url)
            caller_info = self._get_caller_identity_from_sts(sts_proof_url)
            self._validate_role_name(caller_info["role_name"])
            self._validate_account_in_client_config(caller_info["account_id"])

            logger.info(
                "Relay security validation successful",
                caller_account=caller_info["account_id"],
                role_name=caller_info["role_name"],
            )

            return {
                "validated": True,
                "caller_account_id": caller_info["account_id"],
                "role_name": caller_info["role_name"],
            }

        except SecurityValidationError:
            raise
        except Exception as e:
            logger.error("Security validation failed", error=str(e), exc_info=True)
            raise SecurityValidationError(f"Access denied: {str(e)}") from e

    def _validate_sts_url_freshness(self, sts_proof_url: str) -> None:
        """Validate that the STS proof URL is fresh (not expired, not far-future)."""
        try:
            parsed_url = urlparse(sts_proof_url)
            query_params = parse_qs(parsed_url.query)

            expires_list = query_params.get("X-Amz-Expires", [])
            if expires_list and int(expires_list[0]) > MAX_PROOF_EXPIRES_SECONDS:
                raise SecurityValidationError("STS proof URL expires too far in future")

            date_list = query_params.get("X-Amz-Date", [])
            if date_list:
                try:
                    url_datetime = datetime.strptime(date_list[0], "%Y%m%dT%H%M%SZ")
                    url_datetime = url_datetime.replace(tzinfo=timezone.utc)
                    age_seconds = (
                        datetime.now(timezone.utc) - url_datetime
                    ).total_seconds()

                    if age_seconds > MAX_PROOF_AGE_SECONDS:
                        raise SecurityValidationError("STS proof URL is too old")
                except ValueError as exc:
                    raise SecurityValidationError(
                        "Invalid STS proof URL date format"
                    ) from exc

        except SecurityValidationError:
            raise
        except Exception as e:
            logger.error("Failed to validate STS URL freshness", error=str(e))
            raise SecurityValidationError("Invalid STS proof URL format") from e

    def _get_caller_identity_from_sts(self, sts_proof_url: str) -> Dict[str, str]:
        """Fetch and parse caller identity from the STS presigned URL."""
        parsed = urlparse(sts_proof_url)
        host = parsed.netloc.lower()
        scheme = parsed.scheme.lower()

        # SSRF prevention: hard allowlist of STS endpoints
        if scheme != "https" or host not in ALLOWED_STS_HOSTS:
            raise SecurityValidationError(f"Untrusted STS endpoint: {scheme}://{host}")

        req = Request(
            sts_proof_url,
            headers={
                "User-Agent": "NumaStandardModelRelay/1.0",
                "Accept": "application/xml",
            },
        )
        try:
            with urlopen(req, timeout=5) as resp:
                status = resp.getcode()
                body = resp.read()
        except HTTPError as e:
            error_body = e.read() or b""
            logger.error(
                "STS request failed",
                status=e.code,
                body_snippet=_log_body_snippet(error_body),
            )
            raise SecurityValidationError("STS proof verification failed") from e
        except URLError as e:
            logger.error("STS network error", error=str(e))
            raise SecurityValidationError("STS proof verification failed") from e

        if status != 200:
            logger.error("STS request non-200", status=status)
            raise SecurityValidationError("STS proof verification failed")

        # Parse XML response
        try:
            root = ET.fromstring(body)

            ns_uri = ""
            if root.tag.startswith("{") and "}" in root.tag:
                ns_uri = root.tag.split("}")[0].lstrip("{")

            def _find(tag: str):
                if ns_uri:
                    return root.find(f".//{{{ns_uri}}}{tag}")
                return root.find(f".//{tag}")

            account_element = _find("Account")
            arn_element = _find("Arn")
            user_element = _find("UserId")

            account_id: str | None = (
                account_element.text if account_element is not None else None
            )
            arn: str | None = arn_element.text if arn_element is not None else None
            user_id: str | None = (
                user_element.text if user_element is not None else None
            )

            if not account_id or not arn or not user_id:
                logger.error(
                    "Missing identity fields",
                    have_acct=bool(account_id),
                    have_arn=bool(arn),
                    have_user=bool(user_id),
                    body_snippet=_log_body_snippet(body),
                )
                raise SecurityValidationError("Invalid STS response format")
            if not (len(account_id) == 12 and account_id.isdigit()):
                raise SecurityValidationError("Invalid STS account id format")

            if ":assumed-role/" not in arn:
                raise SecurityValidationError("Caller ARN must be an assumed role")
            role_name = arn.split(":assumed-role/")[1].split("/")[0]

            logger.debug(
                "Extracted caller identity",
                account_id=account_id,
                role_name=role_name,
            )
            return {
                "account_id": account_id,
                "role_name": role_name,
                "arn": arn,
                "user_id": user_id,
            }
        except SecurityValidationError:
            raise
        except Exception as e:
            logger.error(
                "Failed to parse STS XML",
                error=str(e),
                body_snippet=_log_body_snippet(body),
            )
            raise SecurityValidationError("Invalid STS response format") from e

    def _validate_role_name(self, role_name: str) -> None:
        """Validate role name against the AgentCore workspace runtime pattern."""
        if ALLOWED_ROLE_REGEX.match(role_name):
            logger.debug("Role name validated", role_name=role_name)
            return

        logger.warning(
            "Role name does not match allowed pattern",
            role_name=role_name,
            allowed_pattern=ALLOWED_ROLE_REGEX.pattern,
        )
        raise SecurityValidationError(f"Role not authorized: {role_name}")

    def _validate_account_in_client_config(self, account_id: str) -> None:
        """
        Validate that the caller account is a known Numa client account.

        Scans numa-client-config for any record where config.clientAccountId
        matches. The field lives nested inside the `config` map written by
        `lib/client-config-node` (email-sender precedent).
        """
        try:
            response = self.client_config_table.scan(
                FilterExpression="config.clientAccountId = :acct_id",
                ExpressionAttributeValues={":acct_id": account_id},
                ProjectionExpression="clientName",
            )

            items = response.get("Items", [])
            if not items:
                logger.warning(
                    "Account not found in client config",
                    account_id=account_id,
                )
                raise SecurityValidationError(f"Account not authorized: {account_id}")

            client_name = items[0].get("clientName", "unknown")
            logger.debug(
                "Account validation successful",
                account_id=account_id,
                client_name=client_name,
            )

        except SecurityValidationError:
            raise
        except Exception as e:
            logger.error(
                "Failed to validate account against client config",
                error=str(e),
                account_id=account_id,
            )
            raise SecurityValidationError("Account validation failed") from e
