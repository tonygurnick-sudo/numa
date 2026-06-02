"""Tests for the Numa Voice config-writer security validator."""

import os
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

os.environ["CLIENT_CONFIG_TABLE_NAME"] = "test-client-config"


from security_validator import (
    ALLOWED_ROLE_REGEX,
    SecurityValidationError,
    VoiceConfigSecurityValidator,
)


class TestRoleNameRegex:
    """Only `{client}_voice-admin` (underscore/dash variants) may write voice config."""

    @pytest.mark.parametrize(
        "role_name",
        [
            "arcanum-demo-tony_voice-admin",
            "arcanum-demo-tony_voice_admin",
            "nd-labs_voice-admin",
            "my-client123_voice-admin",
        ],
    )
    def test_valid_roles(self, role_name: str):
        assert ALLOWED_ROLE_REGEX.match(role_name)

    @pytest.mark.parametrize(
        "role_name",
        [
            # Other client roles must NOT be able to write voice config.
            "arcanum-demo-tony_schedule-runner",
            "arcanum-demo-tony_ws-agent",
            "arcanum-demo-tony_voice-federation",
            "arcanum-demo-tony_voice-admin-extra",
            "voice-admin",
            "_voice-admin",
            "",
        ],
    )
    def test_invalid_roles(self, role_name: str):
        assert not ALLOWED_ROLE_REGEX.match(role_name)


def _make_validator():
    with patch("security_validator.prm_resource") as mock_prm:
        table = MagicMock()
        mock_prm.return_value.Table.return_value = table
        validator = VoiceConfigSecurityValidator()
    return validator, table


class TestStsUrlFreshness:
    def setup_method(self):
        self.validator, _ = _make_validator()

    def test_rejects_excessive_expiry(self):
        url = (
            "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"
            "&X-Amz-Expires=3600&X-Amz-Date=20260327T120000Z"
        )
        with pytest.raises(SecurityValidationError, match="too far in future"):
            self.validator._validate_sts_url_freshness(url)

    def test_rejects_stale_url(self):
        url = (
            "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"
            "&X-Amz-Expires=60&X-Amz-Date=20250101T000000Z"
        )
        with pytest.raises(SecurityValidationError, match="too old"):
            self.validator._validate_sts_url_freshness(url)

    def test_accepts_fresh_url(self):
        date_str = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        url = (
            f"https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"
            f"&X-Amz-Expires=60&X-Amz-Date={date_str}"
        )
        self.validator._validate_sts_url_freshness(url)


class TestStsEndpointValidation:
    def setup_method(self):
        self.validator, _ = _make_validator()

    @pytest.mark.parametrize(
        "url",
        [
            "http://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity",
            "https://evil.example.com/?Action=GetCallerIdentity",
            "https://s3.us-east-1.amazonaws.com/?Action=GetCallerIdentity",
        ],
    )
    def test_rejects_untrusted_endpoint(self, url: str):
        with pytest.raises(SecurityValidationError, match="Untrusted STS endpoint"):
            self.validator._get_caller_identity_from_sts(url)


class TestAuthorizeClientWrite:
    def setup_method(self):
        self.validator, self.table = _make_validator()

    def test_allows_when_caller_account_owns_client(self):
        self.table.get_item.return_value = {
            "Item": {"config": {"clientAccountId": "905418183804"}}
        }
        # Should not raise — caller account matches the record's clientAccountId.
        self.validator.authorize_client_write("arcanum-demo-tony", "905418183804")
        get_kwargs = self.table.get_item.call_args.kwargs
        assert get_kwargs["Key"] == {"clientName": "arcanum-demo-tony"}

    def test_allows_sibling_dev_client_in_same_shared_account(self):
        # arcanum-demo-greg shares q-demo (905418183804) with arcanum-demo-tony.
        self.table.get_item.return_value = {
            "Item": {"config": {"clientAccountId": "905418183804"}}
        }
        self.validator.authorize_client_write("arcanum-demo-greg", "905418183804")

    def test_rejects_cross_account_write(self):
        self.table.get_item.return_value = {
            "Item": {"config": {"clientAccountId": "111111111111"}}
        }
        with pytest.raises(SecurityValidationError, match="not authorized"):
            self.validator.authorize_client_write("other-tenant", "905418183804")

    def test_rejects_unknown_client(self):
        self.table.get_item.return_value = {}
        with pytest.raises(SecurityValidationError, match="Unknown client"):
            self.validator.authorize_client_write("ghost", "905418183804")

    def test_rejects_blank_client_name(self):
        with pytest.raises(SecurityValidationError, match="client_name is required"):
            self.validator.authorize_client_write("  ", "905418183804")

    def test_handles_dynamo_error(self):
        self.table.get_item.side_effect = Exception("DynamoDB timeout")
        with pytest.raises(SecurityValidationError, match="Account validation failed"):
            self.validator.authorize_client_write("arcanum-demo-tony", "905418183804")
