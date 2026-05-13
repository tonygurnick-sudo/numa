"""
Security validation module for Pipedream proxy.

Handles STS presigned URL validation and DynamoDB security mapping.
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


def _log_body_snippet(body: bytes, max_length: int = 200) -> str:
    """Helper function to create consistent body snippets for error logging."""
    return body[:max_length].decode("utf-8", "replace")


# Regex pattern for allowed role names
# Matches:
#   - e.g. arcanum-demo-sydney_pipedream-relay (pipedream relay lambda)
#   - e.g. arcanum-demo-sydney_ws-agent (legacy chat agent)
#   - e.g. arcanum-demo-sydney_chat_agent (current chat agent)
ALLOWED_ROLE_REGEX = re.compile(
    r"^[a-zA-Z0-9-]+_(?:pipedream-relay|ws[_-]agent|chat[_-]agent)$"
)


class SecurityValidationError(Exception):
    """Raised when security validation fails."""


class SecurityValidator:
    """Handles security validation for proxy requests."""

    def __init__(self) -> None:
        self.dynamodb = prm_resource("dynamodb")

        # Security mapping table
        self.security_table_name = os.environ.get("SECURITY_MAPPING_TABLE")
        if not self.security_table_name:
            raise ValueError("SECURITY_MAPPING_TABLE environment variable not set")
        self.security_table = self.dynamodb.Table(self.security_table_name)

        # Allowed accounts table
        self.allowed_accounts_table_name = os.environ.get("ALLOWED_ACCOUNTS_TABLE")
        if not self.allowed_accounts_table_name:
            raise ValueError("ALLOWED_ACCOUNTS_TABLE environment variable not set")
        self.allowed_accounts_table = self.dynamodb.Table(
            self.allowed_accounts_table_name
        )

    def validate_request(
        self, external_user_id: str, sts_proof_url: str
    ) -> Dict[str, Any]:
        """
        Validate incoming proxy request using STS presigned URL and security mapping.

        Args:
            external_user_id: The external user ID from the request
            sts_proof_url: STS presigned GetCallerIdentity URL from caller

        Returns:
            Dict containing validation details

        Raises:
            SecurityValidationError: If validation fails
        """
        try:
            # Step 1: Validate STS proof URL freshness
            self._validate_sts_url_freshness(sts_proof_url)

            # Step 2: Get caller identity from STS URL
            caller_info = self._get_caller_identity_from_sts(sts_proof_url)

            # Step 3: Validate account is in allowed list
            self._validate_account_allowed(caller_info["account_id"])

            # Step 4: Validate role name
            self._validate_role_name(caller_info["role_name"])

            # Step 5: Check security mapping (with negative case handling)
            self._validate_security_mapping(
                external_user_id, caller_info["account_id"], caller_info["role_name"]
            )

            logger.info(
                "Security validation successful",
                external_user_id=external_user_id,
                caller_account=caller_info["account_id"],
                role_name=caller_info["role_name"],
            )

            return {
                "validated": True,
                "caller_account_id": caller_info["account_id"],
                "role_name": caller_info["role_name"],
                "external_user_id": external_user_id,
            }

        except Exception as e:
            logger.error(
                "Security validation failed",
                error=str(e),
                external_user_id=external_user_id,
                exc_info=True,
            )
            raise SecurityValidationError(f"Access denied: {str(e)}") from e

    def _validate_sts_url_freshness(self, sts_proof_url: str) -> None:
        """Validate that the STS proof URL is fresh (not expired)."""
        try:
            parsed_url = urlparse(sts_proof_url)
            query_params = parse_qs(parsed_url.query)

            # Check expiration (max 120 seconds — matches the age check below).
            expires_list = query_params.get("X-Amz-Expires", [])
            if expires_list and int(expires_list[0]) > 120:
                raise SecurityValidationError("STS proof URL expires too far in future")

            # Check age (max 2 minutes)
            date_list = query_params.get("X-Amz-Date", [])
            if date_list:
                try:
                    url_datetime = datetime.strptime(date_list[0], "%Y%m%dT%H%M%SZ")
                    url_datetime = url_datetime.replace(tzinfo=timezone.utc)
                    age_seconds = (
                        datetime.now(timezone.utc) - url_datetime
                    ).total_seconds()

                    if age_seconds > 120:  # 2 minutes max age
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
        parsed = urlparse(sts_proof_url)
        host = parsed.netloc.lower()
        scheme = parsed.scheme.lower()

        # 1) Hard host allow-list to prevent SSRF (Numa deployment regions only)
        # Maybe not absolutely necessary but extra security
        allowed_hosts = {
            "sts.us-east-1.amazonaws.com",  # Primary region
            "sts.ap-southeast-2.amazonaws.com",  # Sydney region
        }
        if scheme != "https" or host not in allowed_hosts:
            raise SecurityValidationError(f"Untrusted STS endpoint: {scheme}://{host}")

        # 2) Fetch STS response
        req = Request(
            sts_proof_url,
            headers={"User-Agent": "NumaProxy/1.0", "Accept": "application/xml"},
        )
        try:
            with urlopen(req, timeout=5) as resp:
                status = resp.getcode()
                ctype = resp.headers.get("Content-Type", "")
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
            logger.error(
                "STS request non-200",
                status=status,
                ctype=ctype,
                body_snippet=_log_body_snippet(body),
            )
            raise SecurityValidationError("STS proof verification failed")

        # 3) Parse XML
        try:
            root = ET.fromstring(body)

            # Handle default XML namespace in STS responses
            # Example root tag: '{https://sts.amazonaws.com/doc/2011-06-15/}GetCallerIdentityResponse'
            ns_uri = ""
            if root.tag.startswith("{") and "}" in root.tag:
                ns_uri = root.tag.split("}")[0].lstrip("{")

            def _find(tag: str):
                if ns_uri:
                    return root.find(f".//{{{ns_uri}}}{tag}")
                return root.find(f".//{tag}")

            # STS responses - extract text values immediately with proper typing
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

            # 4) Basic sanity checks
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

            # Must be assumed role
            if ":assumed-role/" not in arn:
                raise SecurityValidationError("Caller ARN must be an assumed role")
            role_name = arn.split(":assumed-role/")[1].split("/")[0]

            logger.debug(
                "Extracted caller identity from STS",
                account_id=account_id,
                role_name=role_name,
                user_id=user_id,
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
        """Validate role name against regex pattern."""
        if ALLOWED_ROLE_REGEX.match(role_name):
            logger.debug(
                "Role name validated",
                role_name=role_name,
                pattern=ALLOWED_ROLE_REGEX.pattern,
            )
            return

        logger.warning(
            "Role name does not match allowed pattern",
            role_name=role_name,
            allowed_pattern=ALLOWED_ROLE_REGEX.pattern,
        )
        raise SecurityValidationError(f"Role not authorized: {role_name}")

    def _validate_account_allowed(self, account_id: str) -> None:
        """Validate that the caller account is in the allowed accounts table."""
        try:
            # Query the allowed accounts table
            response = self.allowed_accounts_table.get_item(
                Key={"account_id": account_id}
            )

            if "Item" not in response:
                logger.warning(
                    "Account not found in allowed accounts table", account_id=account_id
                )
                raise SecurityValidationError(f"Account not authorized: {account_id}")

            account_item = response["Item"]
            status = account_item.get("status", "SUSPENDED")

            if status != "ACTIVE":
                logger.warning(
                    "Account not active in allowed accounts table",
                    account_id=account_id,
                    status=status,
                )
                raise SecurityValidationError(f"Account not authorized: {account_id}")

            logger.debug(
                "Account validation successful",
                account_id=account_id,
                status=status,
                client_name=account_item.get("client_name", "unknown"),
            )

        except SecurityValidationError:
            raise
        except Exception as e:
            logger.error(
                "Failed to validate account against allowed accounts table",
                error=str(e),
                account_id=account_id,
            )
            raise SecurityValidationError("Account validation failed") from e

    def _validate_security_mapping(
        self, external_user_id: str, account_id: str, role_name: str
    ) -> None:
        """
        Validate security mapping with negative case handling.

        - If no mapping exists: Create new mapping (first-request registration)
        - If mapping exists with same account: Update last_accessed
        - If mapping exists with different account: REJECT (negative case)
        """
        try:
            # Check if mapping exists
            response = self.security_table.get_item(
                Key={"external_user_id": external_user_id}
            )

            if "Item" not in response:
                # No mapping exists - first request registration
                self._create_security_mapping(external_user_id, account_id, role_name)
                logger.info(
                    "Created new security mapping",
                    external_user_id=external_user_id,
                    account_id=account_id,
                )
                return

            # Mapping exists - validate account match
            existing_mapping = response["Item"]
            existing_account_id = existing_mapping["account_id"]

            if existing_account_id != account_id:
                # Negative case with different account trying to access same external_user_id
                logger.error(
                    "Security violation: Account mismatch",
                    external_user_id=external_user_id,
                    existing_account=existing_account_id,
                    requesting_account=account_id,
                )
                raise SecurityValidationError(
                    "External user ID already associated with different account"
                )

            # Valid access - update last accessed time
            self._update_last_accessed(external_user_id)
            logger.debug(
                "Security mapping validated",
                external_user_id=external_user_id,
                account_id=account_id,
            )

        except SecurityValidationError:
            raise
        except Exception as e:
            logger.error(
                "Failed to validate security mapping",
                error=str(e),
                external_user_id=external_user_id,
            )
            raise SecurityValidationError("Security mapping validation failed") from e

    def _create_security_mapping(
        self, external_user_id: str, account_id: str, role_name: str
    ) -> None:
        """Create new security mapping entry."""
        now = datetime.now(timezone.utc).isoformat()

        try:
            self.security_table.put_item(
                Item={
                    "external_user_id": external_user_id,
                    "account_id": account_id,
                    "role_name": role_name,
                    "created_at": now,
                    "last_accessed": now,
                }
            )
        except Exception as e:
            logger.error(
                "Failed to create security mapping",
                error=str(e),
                external_user_id=external_user_id,
            )
            raise

    def _update_last_accessed(self, external_user_id: str) -> None:
        """Update last accessed timestamp."""
        now = datetime.now(timezone.utc).isoformat()

        try:
            self.security_table.update_item(
                Key={"external_user_id": external_user_id},
                UpdateExpression="SET last_accessed = :timestamp",
                ExpressionAttributeValues={":timestamp": now},
            )
        except Exception as e:
            logger.error(
                "Failed to update last accessed time",
                error=str(e),
                external_user_id=external_user_id,
            )
