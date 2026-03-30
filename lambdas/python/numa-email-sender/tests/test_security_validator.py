"""Tests for the email sender security validator."""

import os
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# Set env vars before importing module
os.environ["CLIENT_CONFIG_TABLE_NAME"] = "test-client-config"


from security_validator import (
    ALLOWED_ROLE_REGEX,
    EmailSecurityValidator,
    SecurityValidationError,
)


class TestRoleNameRegex:
    """Test the ALLOWED_ROLE_REGEX pattern."""

    @pytest.mark.parametrize(
        "role_name",
        [
            "nd-labs_schedule-runner",
            "nd-labs_schedule_runner",
            "arcanum-demo-sydney_ws-agent",
            "arcanum-demo-sydney_ws_agent",
            "arcanum-demo-sydney_chat-agent",
            "arcanum-demo-sydney_chat_agent",
            "nd-labs_workspace-chat-tools",
            "nd-labs_workspace_chat_tools",
            "my-client123_schedule-runner",
        ],
    )
    def test_valid_roles(self, role_name: str):
        assert ALLOWED_ROLE_REGEX.match(role_name)

    @pytest.mark.parametrize(
        "role_name",
        [
            "admin-role",
            "nd-labs_pipedream-relay",
            "nd-labs_random-lambda",
            "nd-labs_",
            "_schedule-runner",
            "",
        ],
    )
    def test_invalid_roles(self, role_name: str):
        assert not ALLOWED_ROLE_REGEX.match(role_name)


class TestStsUrlFreshness:
    """Test STS URL freshness validation."""

    def setup_method(self):
        with patch("security_validator.prm_resource") as mock_prm:
            mock_table = MagicMock()
            mock_prm.return_value.Table.return_value = mock_table
            self.validator = EmailSecurityValidator()

    def test_rejects_excessive_expiry(self):
        url = (
            "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"
            "&X-Amz-Expires=3600"
            "&X-Amz-Date=20260327T120000Z"
        )
        with pytest.raises(SecurityValidationError, match="too far in future"):
            self.validator._validate_sts_url_freshness(url)

    def test_rejects_stale_url(self):
        url = (
            "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"
            "&X-Amz-Expires=60"
            "&X-Amz-Date=20250101T000000Z"
        )
        with pytest.raises(SecurityValidationError, match="too old"):
            self.validator._validate_sts_url_freshness(url)

    def test_accepts_fresh_url(self):
        now = datetime.now(timezone.utc)
        date_str = now.strftime("%Y%m%dT%H%M%SZ")
        url = (
            f"https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"
            f"&X-Amz-Expires=60"
            f"&X-Amz-Date={date_str}"
        )
        # Should not raise
        self.validator._validate_sts_url_freshness(url)


class TestStsEndpointValidation:
    """Test STS endpoint SSRF protection."""

    def setup_method(self):
        with patch("security_validator.prm_resource") as mock_prm:
            mock_table = MagicMock()
            mock_prm.return_value.Table.return_value = mock_table
            self.validator = EmailSecurityValidator()

    def test_rejects_non_https(self):
        url = "http://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"
        with pytest.raises(SecurityValidationError, match="Untrusted STS endpoint"):
            self.validator._get_caller_identity_from_sts(url)

    def test_rejects_unknown_host(self):
        url = "https://evil.example.com/?Action=GetCallerIdentity"
        with pytest.raises(SecurityValidationError, match="Untrusted STS endpoint"):
            self.validator._get_caller_identity_from_sts(url)

    def test_rejects_non_sts_aws_host(self):
        url = "https://s3.us-east-1.amazonaws.com/?Action=GetCallerIdentity"
        with pytest.raises(SecurityValidationError, match="Untrusted STS endpoint"):
            self.validator._get_caller_identity_from_sts(url)


class TestAccountValidation:
    """Test account validation against client config table."""

    def setup_method(self):
        with patch("security_validator.prm_resource") as mock_prm:
            self.mock_table = MagicMock()
            mock_prm.return_value.Table.return_value = self.mock_table
            self.validator = EmailSecurityValidator()

    def test_accepts_known_account(self):
        self.mock_table.scan.return_value = {
            "Items": [{"clientName": "nd-labs", "clientAccountId": "123456789012"}]
        }
        # Should not raise
        self.validator._validate_account_in_client_config("123456789012")

    def test_rejects_unknown_account(self):
        self.mock_table.scan.return_value = {"Items": []}
        with pytest.raises(SecurityValidationError, match="Account not authorized"):
            self.validator._validate_account_in_client_config("999999999999")

    def test_handles_dynamo_error(self):
        self.mock_table.scan.side_effect = Exception("DynamoDB timeout")
        with pytest.raises(SecurityValidationError, match="Account validation failed"):
            self.validator._validate_account_in_client_config("123456789012")
