"""
Security validation for the Numa Voice config write-back Lambda.

Adapted from the centralized email-sender validator (lambdas/python/numa-email-sender).
Validates cross-account callers via an STS presigned GetCallerIdentity proof URL and,
on success, RESOLVES the caller's clientName from numa-client-config. The clientName is
derived server-side from the validated caller ACCOUNT — never taken from the request —
so a tenant can only ever write back its OWN config record.
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

# Only the per-client Numa Voice admin Lambda role may write Voice config back.
# NumaLambda names this role `{clientName}_voice-admin` (awsNameWithHashedPrefix);
# accept the underscore/dash spelling variants for safety.
ALLOWED_ROLE_REGEX = re.compile(r"^[a-zA-Z0-9-]+_voice[_-]admin$")


class SecurityValidationError(Exception):
    """Raised when security validation fails."""


def _log_body_snippet(body: bytes, max_length: int = 200) -> str:
    return body[:max_length].decode("utf-8", "replace")


class VoiceConfigSecurityValidator:
    """Validates cross-account Voice config write-back requests via STS proof URLs."""

    def __init__(self) -> None:
        self.dynamodb = prm_resource("dynamodb")
        self.client_config_table_name = os.environ.get("CLIENT_CONFIG_TABLE_NAME")
        if not self.client_config_table_name:
            raise ValueError("CLIENT_CONFIG_TABLE_NAME environment variable not set")
        self.client_config_table = self.dynamodb.Table(self.client_config_table_name)

    def validate_request(self, sts_proof_url: str) -> Dict[str, Any]:
        """
        Validate an incoming write-back request's STS proof + role.

        Returns a dict with caller_account_id and role_name on success. Raises
        SecurityValidationError on any failure. The CALLER ACCOUNT is the trust
        anchor — pair this with ``authorize_client_write`` to confirm the caller
        account owns the specific client record it wants to write.
        """
        try:
            self._validate_sts_url_freshness(sts_proof_url)
            caller_info = self._get_caller_identity_from_sts(sts_proof_url)
            self._validate_role_name(caller_info["role_name"])

            logger.info(
                "Voice config write-back proof validated",
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

    def authorize_client_write(self, client_name: str, caller_account_id: str) -> None:
        """
        Authorize a write to ``client_name``'s config by ``caller_account_id``.

        The caller may write a client record ONLY IF that record's
        config.clientAccountId equals the validated caller account. In production
        each client has its own isolated account (1:1). In dev/demo, several
        clients share one account (N:1) — they are already in the same security
        domain, so allowing each to write a sibling record in the SAME account is
        acceptable; writing across accounts is not. Raises on any mismatch.
        """
        if not isinstance(client_name, str) or not client_name.strip():
            raise SecurityValidationError("client_name is required")
        try:
            item = self.client_config_table.get_item(
                Key={"clientName": client_name},
                ProjectionExpression="config.clientAccountId",
            ).get("Item")
        except Exception as e:
            logger.error(
                "Failed to read client config", error=str(e), client_name=client_name
            )
            raise SecurityValidationError("Account validation failed") from e

        if not item:
            logger.warning("Client config record not found", client_name=client_name)
            raise SecurityValidationError(f"Unknown client: {client_name}")

        owner_account = (item.get("config") or {}).get("clientAccountId")
        if owner_account != caller_account_id:
            logger.warning(
                "Caller account does not own client record",
                client_name=client_name,
                caller_account=caller_account_id,
                owner_account=owner_account,
            )
            raise SecurityValidationError("Account not authorized for this client")

    def _validate_sts_url_freshness(self, sts_proof_url: str) -> None:
        """Validate that the STS proof URL is fresh (short expiry, recently signed)."""
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

        # SSRF prevention: hard allowlist of STS endpoints.
        allowed_hosts = {
            "sts.us-east-1.amazonaws.com",
            "sts.ap-southeast-2.amazonaws.com",
        }
        if scheme != "https" or host not in allowed_hosts:
            raise SecurityValidationError(f"Untrusted STS endpoint: {scheme}://{host}")

        req = Request(
            sts_proof_url,
            headers={
                "User-Agent": "NumaVoiceConfigWriter/1.0",
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

            account_id = account_element.text if account_element is not None else None
            arn = arn_element.text if arn_element is not None else None
            user_id = user_element.text if user_element is not None else None

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
        """Validate role name against the voice-admin pattern."""
        if ALLOWED_ROLE_REGEX.match(role_name):
            return

        logger.warning(
            "Role name does not match allowed pattern",
            role_name=role_name,
            allowed_pattern=ALLOWED_ROLE_REGEX.pattern,
        )
        raise SecurityValidationError(f"Role not authorized: {role_name}")
