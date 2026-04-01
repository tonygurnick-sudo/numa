"""
Security validation for the centralized email sender.

Validates cross-account callers using STS presigned URL proof.
Simplified from the Pipedream proxy security_validator -- no user mapping table,
no allowed accounts table, just validates caller account exists in numa-client-config.
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

# Allowed role name patterns for email sender callers.
# Matches client-account Lambda roles that should be able to send email:
#   - {clientName}_agent-schedule-runner or {clientName}_agent_schedule_runner
#   - {clientName}_schedule-runner or {clientName}_schedule_runner
#   - {clientName}_ws-agent or {clientName}_ws_agent
#   - {clientName}_chat-agent or {clientName}_chat_agent
#   - {clientName}_workspace-chat-tools or {clientName}_workspace_chat_tools
#   - {clientName}_admin-mfa-* (MFA notifications and OTP delivery)
ALLOWED_ROLE_REGEX = re.compile(
    r"^[a-zA-Z0-9-]+_(?:agent[_-]schedule[_-]runner|schedule[_-]runner|ws[_-]agent|chat[_-]agent|workspace[_-]chat[_-]tools|admin[_-]mfa[\w-]*)$"
)


class SecurityValidationError(Exception):
    """Raised when security validation fails."""


def _log_body_snippet(body: bytes, max_length: int = 200) -> str:
    return body[:max_length].decode("utf-8", "replace")


class EmailSecurityValidator:
    """Validates cross-account email sender requests using STS proof URLs."""

    def __init__(self) -> None:
        self.dynamodb = prm_resource("dynamodb")
        self.client_config_table_name = os.environ.get("CLIENT_CONFIG_TABLE_NAME")
        if not self.client_config_table_name:
            raise ValueError("CLIENT_CONFIG_TABLE_NAME environment variable not set")
        self.client_config_table = self.dynamodb.Table(self.client_config_table_name)

    def validate_request(self, sts_proof_url: str) -> Dict[str, Any]:
        """
        Validate an incoming email sender request.

        Args:
            sts_proof_url: STS presigned GetCallerIdentity URL from the caller

        Returns:
            Dict with caller_account_id and role_name on success

        Raises:
            SecurityValidationError: If validation fails
        """
        try:
            self._validate_sts_url_freshness(sts_proof_url)
            caller_info = self._get_caller_identity_from_sts(sts_proof_url)
            self._validate_role_name(caller_info["role_name"])
            self._validate_account_in_client_config(caller_info["account_id"])

            logger.info(
                "Email sender security validation successful",
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
        """Validate that the STS proof URL is fresh (not expired)."""
        try:
            parsed_url = urlparse(sts_proof_url)
            query_params = parse_qs(parsed_url.query)

            expires_list = query_params.get("X-Amz-Expires", [])
            if expires_list and int(expires_list[0]) > 60:
                raise SecurityValidationError("STS proof URL expires too far in future")

            date_list = query_params.get("X-Amz-Date", [])
            if date_list:
                try:
                    url_datetime = datetime.strptime(date_list[0], "%Y%m%dT%H%M%SZ")
                    url_datetime = url_datetime.replace(tzinfo=timezone.utc)
                    age_seconds = (
                        datetime.now(timezone.utc) - url_datetime
                    ).total_seconds()

                    if age_seconds > 120:
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
        allowed_hosts = {
            "sts.us-east-1.amazonaws.com",
            "sts.ap-southeast-2.amazonaws.com",
        }
        if scheme != "https" or host not in allowed_hosts:
            raise SecurityValidationError(f"Untrusted STS endpoint: {scheme}://{host}")

        req = Request(
            sts_proof_url,
            headers={"User-Agent": "NumaEmailSender/1.0", "Accept": "application/xml"},
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
        """Validate role name against allowed patterns."""
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

        Scans numa-client-config for any record where clientAccountId matches.
        """
        try:
            response = self.client_config_table.scan(
                FilterExpression="clientAccountId = :acct_id",
                ExpressionAttributeValues={":acct_id": account_id},
                ProjectionExpression="clientName, clientAccountId",
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
