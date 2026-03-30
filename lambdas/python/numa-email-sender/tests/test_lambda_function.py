"""Tests for the email sender Lambda handler."""

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ["CLIENT_CONFIG_TABLE_NAME"] = "test-client-config"
os.environ["SES_CONFIGURATION_SET"] = "test-config-set"
os.environ["SES_FROM_ADDRESS"] = "Numa <no-reply@notifications.test.ai>"
os.environ["SES_DOMAIN"] = "notifications.test.ai"


from lambda_function import _validate_inputs, handler


def _mock_context():
    ctx = MagicMock()
    ctx.function_name = "numa-email-sender"
    return ctx


def _base_event(**overrides):
    event = {
        "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?valid=true",
        "client_name": "nd-labs",
        "to": ["user@example.com"],
        "template": "schedule_completed",
        "template_data": {"schedule_name": "Test Schedule"},
    }
    event.update(overrides)
    return event


class TestInputValidation:
    """Test input validation."""

    def test_valid_input(self):
        result = _validate_inputs(_base_event())
        assert result["to"] == ["user@example.com"]
        assert result["template"] == "schedule_completed"
        assert result["client_name"] == "nd-labs"

    def test_missing_sts_proof(self):
        with pytest.raises(ValueError, match="sts_proof_url"):
            _validate_inputs(_base_event(sts_proof_url=None))

    def test_empty_to_list(self):
        with pytest.raises(ValueError, match="non-empty"):
            _validate_inputs(_base_event(to=[]))

    def test_invalid_email(self):
        with pytest.raises(ValueError, match="Invalid email"):
            _validate_inputs(_base_event(to=["not-an-email"]))

    def test_too_many_recipients(self):
        with pytest.raises(ValueError, match="Maximum 50"):
            _validate_inputs(_base_event(to=[f"user{i}@test.com" for i in range(51)]))

    def test_invalid_template(self):
        with pytest.raises(ValueError, match="template must be"):
            _validate_inputs(_base_event(template="nonexistent"))

    def test_invalid_cc_email(self):
        with pytest.raises(ValueError, match="Invalid CC"):
            _validate_inputs(_base_event(cc=["bad-email"]))

    def test_optional_fields_default(self):
        result = _validate_inputs(_base_event())
        assert result["cc"] == []
        assert result["reply_to"] == []


class TestHandler:
    """Test the Lambda handler end-to-end."""

    @patch("lambda_function._get_validator")
    @patch("lambda_function._send_email")
    def test_successful_send(self, mock_send, mock_get_validator):
        mock_validator = MagicMock()
        mock_validator.validate_request.return_value = {
            "validated": True,
            "caller_account_id": "123456789012",
            "role_name": "nd-labs_schedule-runner",
        }
        mock_get_validator.return_value = mock_validator
        mock_send.return_value = {"messageId": "test-message-id"}

        result = handler(_base_event(), _mock_context())

        assert result["statusCode"] == 200
        assert result["body"]["success"] is True
        assert result["body"]["messageId"] == "test-message-id"
        mock_send.assert_called_once()

    def test_invalid_input_returns_400(self):
        result = handler({"template": "bad"}, _mock_context())
        assert result["statusCode"] == 400
        assert result["body"]["success"] is False

    @patch("lambda_function._get_validator")
    def test_security_failure_returns_403(self, mock_get_validator):
        from security_validator import SecurityValidationError

        mock_validator = MagicMock()
        mock_validator.validate_request.side_effect = SecurityValidationError("denied")
        mock_get_validator.return_value = mock_validator

        result = handler(_base_event(), _mock_context())

        assert result["statusCode"] == 403
        assert "Access denied" in result["body"]["error"]

    @patch("lambda_function._get_validator")
    @patch("lambda_function._send_email")
    def test_ses_error_returns_500(self, mock_send, mock_get_validator):
        from botocore.exceptions import ClientError

        mock_validator = MagicMock()
        mock_validator.validate_request.return_value = {
            "validated": True,
            "caller_account_id": "123456789012",
            "role_name": "nd-labs_schedule-runner",
        }
        mock_get_validator.return_value = mock_validator
        mock_send.side_effect = ClientError(
            {"Error": {"Message": "Email address not verified"}},
            "SendEmail",
        )

        result = handler(_base_event(), _mock_context())

        assert result["statusCode"] == 500
        assert "Email send failed" in result["body"]["error"]
