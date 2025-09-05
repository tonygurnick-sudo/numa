# pylint: disable=protected-access  # Testing internal methods is expected

import os
import unittest
from datetime import datetime, timezone
from email.message import EmailMessage
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from botocore.exceptions import ClientError

from security_validator import SecurityValidationError, SecurityValidator


class TestSecurityValidator(unittest.TestCase):
    """Test cases for SecurityValidator class."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
        }

        self.external_user_id = "arcanum_demo_user123"
        self.valid_sts_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20230813%2Fus-east-1%2Fsts%2Faws4_request&X-Amz-Date=20230813T100000Z&X-Amz-Expires=60&X-Amz-SignedHeaders=host&X-Amz-Signature=example"

        # Mock STS response XML
        self.valid_sts_response = b"""<?xml version="1.0" encoding="UTF-8"?>
<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
    <GetCallerIdentityResult>
        <Account>123456789012</Account>
        <Arn>arn:aws:sts::123456789012:assumed-role/arcanum-demo-test_pipedream-relay/session-name</Arn>
        <UserId>AIDACKCEVSQ6C2EXAMPLE:session-name</UserId>
    </GetCallerIdentityResult>
    <ResponseMetadata>
        <RequestId>01234567-89ab-cdef-0123-456789abcdef</RequestId>
    </ResponseMetadata>
</GetCallerIdentityResponse>"""

    @patch("boto3.resource")
    def test_init_missing_security_table(self, _mock_boto_resource) -> None:
        """Test SecurityValidator init with missing SECURITY_MAPPING_TABLE."""
        env_vars = {"ALLOWED_ACCOUNTS_TABLE": "test-table"}

        with patch.dict(os.environ, env_vars, clear=True):
            with self.assertRaises(ValueError) as context:
                SecurityValidator()

            self.assertIn(
                "SECURITY_MAPPING_TABLE environment variable not set",
                str(context.exception),
            )

    @patch("boto3.resource")
    def test_init_missing_allowed_accounts_table(self, _mock_boto_resource) -> None:
        """Test SecurityValidator init with missing ALLOWED_ACCOUNTS_TABLE."""
        env_vars = {"SECURITY_MAPPING_TABLE": "test-table"}

        with patch.dict(os.environ, env_vars, clear=True):
            with self.assertRaises(ValueError) as context:
                SecurityValidator()

            self.assertIn(
                "ALLOWED_ACCOUNTS_TABLE environment variable not set",
                str(context.exception),
            )

    @patch("boto3.resource")
    def test_init_success(self, _mock_boto_resource) -> None:
        """Test successful SecurityValidator initialization."""
        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            self.assertIsNotNone(validator.security_table)
            self.assertIsNotNone(validator.allowed_accounts_table)
            self.assertEqual(
                validator.security_table_name, "pipedream-security-mapping"
            )
            self.assertEqual(
                validator.allowed_accounts_table_name, "pipedream-allowed-accounts"
            )


class TestSTSValidation(unittest.TestCase):
    """Test cases for STS URL validation."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
        }

    @patch("boto3.resource")
    def test_validate_sts_url_freshness_expired_url(self, _mock_boto_resource) -> None:
        """Test STS URL validation with expired URL (too long expiration)."""
        expired_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&X-Amz-Expires=3600"  # 1 hour

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_sts_url_freshness(expired_url)

            self.assertIn(
                "STS proof URL expires too far in future", str(context.exception)
            )

    @patch("boto3.resource")
    def test_validate_sts_url_freshness_old_url(self, _mock_boto_resource) -> None:
        """Test STS URL validation with old URL (created more than 2 minutes ago)."""
        old_datetime = datetime.now(timezone.utc)
        old_datetime = old_datetime.replace(year=2020, month=1, day=1)  # Very old
        old_url = f"https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&X-Amz-Date={old_datetime.strftime('%Y%m%dT%H%M%SZ')}&X-Amz-Expires=60"

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_sts_url_freshness(old_url)

            self.assertIn("STS proof URL is too old", str(context.exception))

    @patch("boto3.resource")
    def test_validate_sts_url_freshness_invalid_date_format(
        self, _mock_boto_resource
    ) -> None:
        """Test STS URL validation with invalid date format."""
        invalid_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&X-Amz-Date=invalid-date&X-Amz-Expires=60"

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_sts_url_freshness(invalid_url)

            self.assertIn("Invalid STS proof URL date format", str(context.exception))

    @patch("boto3.resource")
    @patch("urllib.request.urlopen")
    def test_get_caller_identity_invalid_host(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test STS caller identity with invalid host."""
        invalid_url = "https://malicious-site.com/?Action=GetCallerIdentity"

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._get_caller_identity_from_sts(invalid_url)

            self.assertIn("Untrusted STS endpoint", str(context.exception))

    @patch("boto3.resource")
    @patch("urllib.request.urlopen")
    def test_get_caller_identity_http_not_https(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test STS caller identity with HTTP instead of HTTPS."""
        http_url = "http://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._get_caller_identity_from_sts(http_url)

            self.assertIn("Untrusted STS endpoint", str(context.exception))

    @patch("boto3.resource")
    @patch("security_validator.urlopen")
    def test_get_caller_identity_success(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test successful STS caller identity retrieval."""
        valid_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"

        # Mock successful HTTP response
        mock_response = Mock()
        mock_response.getcode.return_value = 200
        mock_response.headers = {"Content-Type": "application/xml"}
        mock_response.read.return_value = b"""<?xml version="1.0" encoding="UTF-8"?>
<GetCallerIdentityResponse>
    <GetCallerIdentityResult>
        <Account>123456789012</Account>
        <Arn>arn:aws:sts::123456789012:assumed-role/arcanum-demo-test_pipedream-relay/session-name</Arn>
        <UserId>AIDACKCEVSQ6C2EXAMPLE:session-name</UserId>
    </GetCallerIdentityResult>
</GetCallerIdentityResponse>"""

        _mock_urlopen.return_value.__enter__.return_value = mock_response

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()
            result = validator._get_caller_identity_from_sts(valid_url)

            self.assertEqual(result["account_id"], "123456789012")
            self.assertEqual(result["role_name"], "arcanum-demo-test_pipedream-relay")
            self.assertEqual(result["user_id"], "AIDACKCEVSQ6C2EXAMPLE:session-name")

    @patch("boto3.resource")
    @patch("security_validator.urlopen")
    def test_get_caller_identity_success_with_namespace(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test successful STS caller identity retrieval when XML has default namespace."""
        valid_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"

        # Mock successful HTTP response with XML namespace (real STS shape)
        mock_response = Mock()
        mock_response.getcode.return_value = 200
        mock_response.headers = {"Content-Type": "application/xml"}
        namespaced_xml = b"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<GetCallerIdentityResponse xmlns=\"https://sts.amazonaws.com/doc/2011-06-15/\">
    <GetCallerIdentityResult>
        <Account>123456789012</Account>
        <Arn>arn:aws:sts::123456789012:assumed-role/arcanum-demo-test_pipedream-relay/session-name</Arn>
        <UserId>AIDACKCEVSQ6C2EXAMPLE:session-name</UserId>
    </GetCallerIdentityResult>
    <ResponseMetadata>
        <RequestId>01234567-89ab-cdef-0123-456789abcdef</RequestId>
    </ResponseMetadata>
</GetCallerIdentityResponse>"""
        mock_response.read.return_value = namespaced_xml

        _mock_urlopen.return_value.__enter__.return_value = mock_response

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()
            result = validator._get_caller_identity_from_sts(valid_url)

            self.assertEqual(result["account_id"], "123456789012")
            self.assertEqual(result["role_name"], "arcanum-demo-test_pipedream-relay")
            self.assertEqual(result["user_id"], "AIDACKCEVSQ6C2EXAMPLE:session-name")

    @patch("boto3.resource")
    @patch("urllib.request.urlopen")
    def test_get_caller_identity_http_error(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test STS caller identity with HTTP error."""
        valid_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"

        _mock_urlopen.side_effect = HTTPError(
            url=valid_url, code=403, msg="Forbidden", hdrs=EmailMessage(), fp=None
        )

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._get_caller_identity_from_sts(valid_url)

            self.assertIn("STS proof verification failed", str(context.exception))

    @patch("boto3.resource")
    @patch("urllib.request.urlopen")
    def test_get_caller_identity_network_error(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test STS caller identity with network error."""
        valid_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"

        _mock_urlopen.side_effect = URLError("Network unreachable")

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._get_caller_identity_from_sts(valid_url)

            self.assertIn("STS proof verification failed", str(context.exception))

    @patch("boto3.resource")
    @patch("security_validator.urlopen")
    def test_get_caller_identity_invalid_xml(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test STS caller identity with invalid XML response."""
        valid_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"

        mock_response = Mock()
        mock_response.getcode.return_value = 200
        mock_response.headers = {"Content-Type": "application/xml"}
        mock_response.read.return_value = b"invalid xml"

        _mock_urlopen.return_value.__enter__.return_value = mock_response

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._get_caller_identity_from_sts(valid_url)

            self.assertIn("Invalid STS response format", str(context.exception))

    @patch("boto3.resource")
    @patch("security_validator.urlopen")
    def test_get_caller_identity_not_assumed_role(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test STS caller identity with non-assumed-role ARN."""
        valid_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"

        mock_response = Mock()
        mock_response.getcode.return_value = 200
        mock_response.headers = {"Content-Type": "application/xml"}
        mock_response.read.return_value = b"""<?xml version="1.0" encoding="UTF-8"?>
<GetCallerIdentityResponse>
    <GetCallerIdentityResult>
        <Account>123456789012</Account>
        <Arn>arn:aws:iam::123456789012:user/regular-user</Arn>
        <UserId>AIDACKCEVSQ6C2EXAMPLE</UserId>
    </GetCallerIdentityResult>
</GetCallerIdentityResponse>"""

        _mock_urlopen.return_value.__enter__.return_value = mock_response

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._get_caller_identity_from_sts(valid_url)

            self.assertIn("Caller ARN must be an assumed role", str(context.exception))


class TestRoleValidation(unittest.TestCase):
    """Test cases for role name validation."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
        }

    @patch("boto3.resource")
    def test_validate_role_name_valid_pipedream_relay(
        self, _mock_boto_resource
    ) -> None:
        """Test role validation with valid pipedream-relay role."""
        valid_role = "arcanum-demo-test_pipedream-relay"

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()
            validator._validate_role_name(valid_role)  # Should not raise

    @patch("boto3.resource")
    def test_validate_role_name_valid_ws_agent(self, _mock_boto_resource) -> None:
        """Test role validation with valid ws-agent role."""
        valid_role = "arcanum-demo-test_ws-agent"

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()
            validator._validate_role_name(valid_role)  # Should not raise

    @patch("boto3.resource")
    def test_validate_role_name_invalid_role(self, _mock_boto_resource) -> None:
        """Test role validation with invalid role name."""
        invalid_role = "some-invalid-role"

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_role_name(invalid_role)

            self.assertIn("Role not authorized", str(context.exception))

    @patch("boto3.resource")
    def test_validate_role_name_wrong_suffix(self, _mock_boto_resource) -> None:
        """Test role validation with wrong suffix."""
        invalid_role = "arcanum-demo-test_wrong-suffix"

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_role_name(invalid_role)

            self.assertIn("Role not authorized", str(context.exception))


class TestAccountValidation(unittest.TestCase):
    """Test cases for account validation."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
        }

    @patch("boto3.resource")
    def test_validate_account_allowed_success(self, _mock_boto_resource) -> None:
        """Test successful account validation."""
        account_id = "123456789012"

        # Mock DynamoDB table
        mock_dynamodb = Mock()
        mock_table = Mock()
        _mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        mock_table.get_item.return_value = {
            "Item": {
                "account_id": account_id,
                "status": "ACTIVE",
                "client_name": "test_client",
            }
        }

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()
            validator._validate_account_allowed(account_id)  # Should not raise

    @patch("boto3.resource")
    def test_validate_account_not_found(self, _mock_boto_resource) -> None:
        """Test account validation with account not in allowed table."""
        account_id = "999999999999"

        # Mock DynamoDB table
        mock_dynamodb = Mock()
        mock_table = Mock()
        _mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        mock_table.get_item.return_value = {}  # No Item key

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_account_allowed(account_id)

            self.assertIn("Account not authorized", str(context.exception))

    @patch("boto3.resource")
    def test_validate_account_suspended(self, _mock_boto_resource) -> None:
        """Test account validation with suspended account."""
        account_id = "123456789012"

        # Mock DynamoDB table
        mock_dynamodb = Mock()
        mock_table = Mock()
        _mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        mock_table.get_item.return_value = {
            "Item": {
                "account_id": account_id,
                "status": "SUSPENDED",
                "client_name": "test_client",
            }
        }

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_account_allowed(account_id)

            self.assertIn("Account not authorized", str(context.exception))

    @patch("boto3.resource")
    def test_validate_account_dynamodb_error(self, _mock_boto_resource) -> None:
        """Test account validation with DynamoDB error."""
        account_id = "123456789012"

        # Mock DynamoDB table
        mock_dynamodb = Mock()
        mock_table = Mock()
        _mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        mock_table.get_item.side_effect = ClientError(
            {
                "Error": {
                    "Code": "ResourceNotFoundException",
                    "Message": "Table not found",
                }
            },
            "GetItem",
        )

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_account_allowed(account_id)

            self.assertIn("Account validation failed", str(context.exception))


class TestSecurityMapping(unittest.TestCase):
    """Test cases for security mapping validation."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
        }

    @patch("boto3.resource")
    def test_validate_security_mapping_first_request(self, _mock_boto_resource) -> None:
        """Test security mapping validation for first request (creates new mapping)."""
        external_user_id = "arcanum_demo_user123"
        account_id = "123456789012"
        role_name = "arcanum-demo-test_pipedream-relay"

        # Mock DynamoDB table
        mock_dynamodb = Mock()
        mock_table = Mock()
        _mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        # No existing mapping
        mock_table.get_item.return_value = {}

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()
            validator._validate_security_mapping(
                external_user_id, account_id, role_name
            )

            # Should have created new mapping
            mock_table.put_item.assert_called_once()

    @patch("boto3.resource")
    def test_validate_security_mapping_existing_same_account(
        self, _mock_boto_resource
    ) -> None:
        """Test security mapping validation with existing mapping for same account."""
        external_user_id = "arcanum_demo_user123"
        account_id = "123456789012"
        role_name = "arcanum-demo-test_pipedream-relay"

        # Mock DynamoDB table
        mock_dynamodb = Mock()
        mock_table = Mock()
        _mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        # Existing mapping with same account
        mock_table.get_item.return_value = {
            "Item": {
                "external_user_id": external_user_id,
                "account_id": account_id,
                "role_name": role_name,
            }
        }

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()
            validator._validate_security_mapping(
                external_user_id, account_id, role_name
            )

            # Should have updated last accessed
            mock_table.update_item.assert_called_once()

    @patch("boto3.resource")
    def test_validate_security_mapping_cross_account_violation(
        self, _mock_boto_resource
    ) -> None:
        """Test security mapping validation with cross-account violation."""
        external_user_id = "arcanum_demo_user123"
        account_id = "123456789012"
        different_account_id = "999999999999"
        role_name = "arcanum-demo-test_pipedream-relay"

        # Mock DynamoDB table
        mock_dynamodb = Mock()
        mock_table = Mock()
        _mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        # Existing mapping with different account (negative case)
        mock_table.get_item.return_value = {
            "Item": {
                "external_user_id": external_user_id,
                "account_id": different_account_id,  # Different account!
                "role_name": role_name,
            }
        }

        with patch.dict(os.environ, self.env_vars):
            validator = SecurityValidator()

            with self.assertRaises(SecurityValidationError) as context:
                validator._validate_security_mapping(
                    external_user_id, account_id, role_name
                )

            self.assertIn(
                "External user ID already associated with different account",
                str(context.exception),
            )


class TestValidateRequestIntegration(unittest.TestCase):
    """Integration tests for the complete validate_request flow."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
        }

        self.external_user_id = "arcanum_demo_user123"
        self.valid_sts_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20230813%2Fus-east-1%2Fsts%2Faws4_request&X-Amz-Date=20230813T100000Z&X-Amz-Expires=60&X-Amz-SignedHeaders=host&X-Amz-Signature=example"

    @patch("boto3.resource")
    @patch("security_validator.urlopen")
    def test_validate_request_complete_success(
        self, _mock_urlopen, _mock_boto_resource
    ) -> None:
        """Test complete successful validation request flow."""
        # Mock STS response
        mock_response = Mock()
        mock_response.getcode.return_value = 200
        mock_response.headers = {"Content-Type": "application/xml"}
        mock_response.read.return_value = b"""<?xml version="1.0" encoding="UTF-8"?>
<GetCallerIdentityResponse>
    <GetCallerIdentityResult>
        <Account>123456789012</Account>
        <Arn>arn:aws:sts::123456789012:assumed-role/arcanum-demo-test_pipedream-relay/session-name</Arn>
        <UserId>AIDACKCEVSQ6C2EXAMPLE:session-name</UserId>
    </GetCallerIdentityResult>
</GetCallerIdentityResponse>"""

        _mock_urlopen.return_value.__enter__.return_value = mock_response

        # Mock DynamoDB tables
        mock_dynamodb = Mock()
        _mock_boto_resource.return_value = mock_dynamodb

        def mock_table_side_effect(table_name):
            if "allowed-accounts" in table_name:
                # Allowed accounts table
                allowed_table = Mock()
                allowed_table.get_item.return_value = {
                    "Item": {
                        "account_id": "123456789012",
                        "status": "ACTIVE",
                        "client_name": "test_client",
                    }
                }
                return allowed_table
            else:
                # Security mapping table
                security_table = Mock()
                security_table.get_item.return_value = {}  # No existing mapping
                return security_table

        mock_dynamodb.Table.side_effect = mock_table_side_effect

        with patch.dict(os.environ, self.env_vars):
            with patch("security_validator.datetime") as mock_datetime:
                mock_now = datetime(2023, 8, 13, 10, 0, 30, tzinfo=timezone.utc)
                mock_datetime.now.return_value = mock_now
                mock_datetime.timezone = timezone
                mock_datetime.strptime.return_value = datetime(
                    2023, 8, 13, 10, 0, 0, tzinfo=timezone.utc
                )

                validator = SecurityValidator()
                result = validator.validate_request(
                    self.external_user_id, self.valid_sts_url
                )

                self.assertTrue(result["validated"])
                self.assertEqual(result["caller_account_id"], "123456789012")
                self.assertEqual(
                    result["role_name"], "arcanum-demo-test_pipedream-relay"
                )
                self.assertEqual(result["external_user_id"], self.external_user_id)


if __name__ == "__main__":
    unittest.main()
