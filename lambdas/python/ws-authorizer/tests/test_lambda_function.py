import os
import unittest
from unittest.mock import Mock, patch

import jwt

from lambda_function import (
    _jwks_cache,
    generate_policy,
    get_jwks,
    handler,
    verify_jwt_token,
)


class TestWSAuthorizer(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures"""
        # Clear JWKS cache before each test
        _jwks_cache["data"] = None

        # Set up environment variables
        self.env_patcher = patch.dict(
            os.environ,
            {
                "COGNITO_USER_POOL_ID": "us-east-1_TestPool",
                "COGNITO_USER_POOL_CLIENT_ID": "test-client-id",
                "AWS_REGION": "us-east-1",
            },
        )
        self.env_patcher.start()

        # Mock JWKS response
        self.mock_jwks = {
            "keys": [
                {
                    "kid": "test-key-id",
                    "kty": "RSA",
                    "use": "sig",
                    "n": "test-n-value",
                    "e": "AQAB",
                }
            ]
        }

        # Sample JWT payloads
        self.id_token_payload = {
            "sub": "user-123",
            "email": "test@example.com",
            "token_use": "id",
            "aud": "test-client-id",
            "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool",
            "exp": 9999999999,
            "cognito:groups": ["admin", "user"],
        }

        self.access_token_payload = {
            "sub": "user-123",
            "client_id": "test-client-id",
            "token_use": "access",
            "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool",
            "exp": 9999999999,
            "scope": "aws.cognito.signin.user.admin",
        }

        # Sample event
        self.valid_event = {
            "queryStringParameters": {"Authorization": "valid-token"},
            "methodArn": "arn:aws:execute-api:us-east-1:123456789012:abcdef123/*/POST/*",
        }

    def tearDown(self):
        """Clean up after tests"""
        self.env_patcher.stop()
        _jwks_cache["data"] = None

    @patch("lambda_function.USER_POOL_ID", "us-east-1_TestPool")
    @patch("lambda_function.REGION", "us-east-1")
    @patch("lambda_function.requests.get")
    def test_get_jwks_success(self, mock_get):
        """Test successful JWKS retrieval"""
        mock_response = Mock()
        mock_response.json.return_value = self.mock_jwks
        mock_response.raise_for_status.return_value = None
        mock_get.return_value = mock_response

        result = get_jwks()

        self.assertEqual(result, self.mock_jwks)
        mock_get.assert_called_once_with(
            "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool/.well-known/jwks.json",
            timeout=10,
        )

        # Test caching - second call should not make HTTP request
        result2 = get_jwks()
        self.assertEqual(result2, self.mock_jwks)
        self.assertEqual(mock_get.call_count, 1)

    @patch("lambda_function.requests.get")
    def test_get_jwks_http_error(self, mock_get):
        """Test JWKS retrieval with HTTP error"""
        mock_get.side_effect = Exception("Network error")

        with self.assertRaises(Exception):
            get_jwks()

    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.decode")
    @patch("lambda_function.jwt.get_unverified_header")
    @patch("lambda_function.algorithms.RSAAlgorithm.from_jwk")
    def test_verify_jwt_token_id_token_success(
        self, mock_from_jwk, mock_header, mock_decode, mock_get_jwks
    ):
        """Test successful ID token verification"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {"kid": "test-key-id"}
        mock_from_jwk.return_value = Mock()

        # Mock the two jwt.decode calls
        mock_decode.side_effect = [
            self.id_token_payload,  # First decode for token_use check
            self.id_token_payload,  # Second decode with audience verification
        ]

        result = verify_jwt_token("test-token")

        self.assertEqual(result, self.id_token_payload)
        self.assertEqual(mock_decode.call_count, 2)

    @patch("lambda_function.USER_POOL_CLIENT_ID", "test-client-id")
    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.decode")
    @patch("lambda_function.jwt.get_unverified_header")
    @patch("lambda_function.algorithms.RSAAlgorithm.from_jwk")
    def test_verify_jwt_token_access_token_success(
        self, mock_from_jwk, mock_header, mock_decode, mock_get_jwks
    ):
        """Test successful access token verification"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {"kid": "test-key-id"}
        mock_from_jwk.return_value = Mock()
        mock_decode.return_value = self.access_token_payload

        result = verify_jwt_token("test-token")

        self.assertEqual(result, self.access_token_payload)

    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.get_unverified_header")
    def test_verify_jwt_token_missing_kid(self, mock_header, mock_get_jwks):
        """Test token verification with missing kid in header"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {}  # No kid

        with self.assertRaises(ValueError) as cm:
            verify_jwt_token("test-token")

        self.assertIn("Token missing 'kid' in header", str(cm.exception))

    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.get_unverified_header")
    def test_verify_jwt_token_key_not_found(self, mock_header, mock_get_jwks):
        """Test token verification with non-existent key ID"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {"kid": "non-existent-key"}

        with self.assertRaises(ValueError) as cm:
            verify_jwt_token("test-token")

        self.assertIn("Unable to find matching key", str(cm.exception))

    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.decode")
    @patch("lambda_function.jwt.get_unverified_header")
    @patch("lambda_function.algorithms.RSAAlgorithm.from_jwk")
    def test_verify_jwt_token_expired(
        self, mock_from_jwk, mock_header, mock_decode, mock_get_jwks
    ):
        """Test expired token handling"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {"kid": "test-key-id"}
        mock_from_jwk.return_value = Mock()
        mock_decode.side_effect = jwt.ExpiredSignatureError("Token expired")

        with self.assertRaises(ValueError) as cm:
            verify_jwt_token("test-token")

        self.assertIn("Token has expired", str(cm.exception))

    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.decode")
    @patch("lambda_function.jwt.get_unverified_header")
    @patch("lambda_function.algorithms.RSAAlgorithm.from_jwk")
    def test_verify_jwt_token_invalid_token(
        self, mock_from_jwk, mock_header, mock_decode, mock_get_jwks
    ):
        """Test invalid token handling"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {"kid": "test-key-id"}
        mock_from_jwk.return_value = Mock()
        mock_decode.side_effect = jwt.InvalidTokenError("Invalid token")

        with self.assertRaises(ValueError) as cm:
            verify_jwt_token("test-token")

        self.assertIn("Invalid token", str(cm.exception))

    def test_verify_jwt_token_bearer_prefix(self):
        """Test token with Bearer prefix is handled correctly"""
        with patch("lambda_function.get_jwks") as mock_get_jwks, patch(
            "lambda_function.jwt.get_unverified_header"
        ) as mock_header, patch("lambda_function.jwt.decode") as mock_decode, patch(
            "lambda_function.algorithms.RSAAlgorithm.from_jwk"
        ) as mock_from_jwk:

            mock_get_jwks.return_value = self.mock_jwks
            mock_header.return_value = {"kid": "test-key-id"}
            mock_from_jwk.return_value = Mock()
            mock_decode.side_effect = [self.id_token_payload, self.id_token_payload]

            result = verify_jwt_token("Bearer test-token")

            # Verify the token was processed (Bearer prefix removed)
            self.assertEqual(result, self.id_token_payload)

    def test_generate_policy_allow(self):
        """Test policy generation for Allow effect"""
        context = {"user_id": "test-user", "email": "test@example.com"}
        policy = generate_policy("user-123", "Allow", "arn:aws:execute-api:*", context)

        expected = {
            "principalId": "user-123",
            "policyDocument": {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Action": "execute-api:Invoke",
                        "Effect": "Allow",
                        "Resource": "arn:aws:execute-api:*",
                    }
                ],
            },
            "context": context,
        }

        self.assertEqual(policy, expected)

    def test_generate_policy_deny(self):
        """Test policy generation for Deny effect"""
        policy = generate_policy("user-123", "Deny", "arn:aws:execute-api:*")

        expected = {
            "principalId": "user-123",
            "policyDocument": {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Action": "execute-api:Invoke",
                        "Effect": "Deny",
                        "Resource": "arn:aws:execute-api:*",
                    }
                ],
            },
        }

        self.assertEqual(policy, expected)

    @patch("lambda_function.verify_jwt_token")
    def test_handler_success_id_token(self, mock_verify):
        """Test successful authorization with ID token"""
        mock_verify.return_value = self.id_token_payload

        result = handler(self.valid_event, None)

        expected_context = {
            "sub": "user-123",
            "email": "test@example.com",
            "groups": "admin,user",
            "token_use": "id",
        }

        self.assertEqual(result["principalId"], "user-123")
        self.assertEqual(result["policyDocument"]["Statement"][0]["Effect"], "Allow")
        self.assertEqual(result["context"], expected_context)
        mock_verify.assert_called_once_with("valid-token")

    @patch("lambda_function.verify_jwt_token")
    def test_handler_success_access_token(self, mock_verify):
        """Test successful authorization with access token"""
        mock_verify.return_value = self.access_token_payload

        result = handler(self.valid_event, None)

        expected_context = {
            "sub": "user-123",
            "email": "",
            "groups": "",
            "token_use": "access",
        }

        self.assertEqual(result["principalId"], "user-123")
        self.assertEqual(result["policyDocument"]["Statement"][0]["Effect"], "Allow")
        self.assertEqual(result["context"], expected_context)

    def test_handler_missing_token(self):
        """Test handler with missing authorization token"""
        event = {
            "queryStringParameters": {},
            "methodArn": "arn:aws:execute-api:us-east-1:123456789012:abcdef123/*/POST/*",
        }

        with self.assertRaises(ValueError) as cm:
            handler(event, None)

        self.assertIn("No authorization token provided", str(cm.exception))

    def test_handler_null_query_params(self):
        """Test handler with null query parameters"""
        event = {
            "queryStringParameters": None,
            "methodArn": "arn:aws:execute-api:us-east-1:123456789012:abcdef123/*/POST/*",
        }

        with self.assertRaises(ValueError) as cm:
            handler(event, None)

        self.assertIn("No authorization token provided", str(cm.exception))

    @patch("lambda_function.verify_jwt_token")
    def test_handler_jwt_verification_failure(self, mock_verify):
        """Test handler with JWT verification failure"""
        mock_verify.side_effect = ValueError("Invalid token")

        with self.assertRaises(ValueError) as cm:
            handler(self.valid_event, None)

        self.assertIn("Invalid token", str(cm.exception))

    @patch("lambda_function.verify_jwt_token")
    def test_handler_missing_sub_claim(self, mock_verify):
        """Test handler with missing sub claim in token"""
        invalid_payload = {**self.id_token_payload}
        del invalid_payload["sub"]
        mock_verify.return_value = invalid_payload

        with self.assertRaises(ValueError) as cm:
            handler(self.valid_event, None)

        self.assertIn("Missing required user ID", str(cm.exception))

    @patch("lambda_function.verify_jwt_token")
    def test_handler_empty_payload(self, mock_verify):
        """Test handler with empty payload"""
        mock_verify.return_value = {}

        with self.assertRaises(ValueError) as cm:
            handler(self.valid_event, None)

        self.assertIn("JWT verification failed", str(cm.exception))

    @patch("lambda_function.verify_jwt_token")
    def test_handler_none_payload(self, mock_verify):
        """Test handler with None payload"""
        mock_verify.return_value = None

        with self.assertRaises(ValueError) as cm:
            handler(self.valid_event, None)

        self.assertIn("JWT verification failed", str(cm.exception))

    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.decode")
    @patch("lambda_function.jwt.get_unverified_header")
    @patch("lambda_function.algorithms.RSAAlgorithm.from_jwk")
    def test_verify_jwt_token_wrong_client_id(
        self, mock_from_jwk, mock_header, mock_decode, mock_get_jwks
    ):
        """Test access token with wrong client_id"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {"kid": "test-key-id"}
        mock_from_jwk.return_value = Mock()

        wrong_payload = {**self.access_token_payload, "client_id": "wrong-client-id"}
        mock_decode.return_value = wrong_payload

        with self.assertRaises(ValueError) as cm:
            verify_jwt_token("test-token")

        self.assertIn("Invalid client_id", str(cm.exception))

    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.decode")
    @patch("lambda_function.jwt.get_unverified_header")
    @patch("lambda_function.algorithms.RSAAlgorithm.from_jwk")
    def test_verify_jwt_token_unknown_token_use(
        self, mock_from_jwk, mock_header, mock_decode, mock_get_jwks
    ):
        """Test token with unknown token_use value"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {"kid": "test-key-id"}
        mock_from_jwk.return_value = Mock()

        unknown_payload = {**self.id_token_payload, "token_use": "unknown"}
        mock_decode.return_value = unknown_payload

        with self.assertRaises(ValueError) as cm:
            verify_jwt_token("test-token")

        self.assertIn("Unknown token_use", str(cm.exception))

    @patch("lambda_function.get_jwks")
    @patch("lambda_function.jwt.decode")
    @patch("lambda_function.jwt.get_unverified_header")
    @patch("lambda_function.algorithms.RSAAlgorithm.from_jwk")
    def test_verify_jwt_token_missing_sub(
        self, mock_from_jwk, mock_header, mock_decode, mock_get_jwks
    ):
        """Test token verification with missing sub claim"""
        mock_get_jwks.return_value = self.mock_jwks
        mock_header.return_value = {"kid": "test-key-id"}
        mock_from_jwk.return_value = Mock()

        payload_no_sub = {**self.id_token_payload}
        del payload_no_sub["sub"]
        mock_decode.side_effect = [payload_no_sub, payload_no_sub]

        with self.assertRaises(ValueError) as cm:
            verify_jwt_token("test-token")

        self.assertIn("Token missing required 'sub' claim", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
