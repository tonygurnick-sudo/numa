import unittest
from unittest.mock import MagicMock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

from lambda_function import (
    MAX_DEPTH,
    MIN_DEPTH,
    _validate_request,
    handler,
)


class TestEnqueueUrl(unittest.TestCase):
    def test_validate_request_missing_fields(self):
        """Test request validation rejects missing fields"""
        result = _validate_request({})
        self.assertIsNone(result)
        result = _validate_request({"url": "https://example.com"})
        self.assertIsNone(result)

    def test_validate_request_normalizes_url(self):
        """Test that URLs without protocol get normalized"""
        result = _validate_request({"url": "example.com", "userId": "user123"})
        self.assertIsNotNone(result)
        if result:
            self.assertEqual(result["url"], "https://example.com")

        # Test with www prefix
        result = _validate_request({"url": "www.example.com", "userId": "user123"})
        self.assertIsNotNone(result)
        if result:
            self.assertEqual(result["url"], "https://www.example.com")

    def test_validate_request_valid(self):
        """Test request validation with valid data"""
        result = _validate_request({"url": "https://example.com", "userId": "user123"})
        self.assertIsNotNone(result)
        if result:
            self.assertEqual(result["url"], "https://example.com")
            self.assertEqual(result["userId"], "user123")
            self.assertEqual(result["crawlDepth"], MIN_DEPTH)

        result = _validate_request(
            {"url": "https://example.com", "userId": "user123", "crawlDepth": 3}
        )
        if result:
            self.assertEqual(result["crawlDepth"], 3)

    def test_validate_request_depth_range(self):
        """Test that crawl depth is constrained to allowed range"""
        with self.assertRaises(ValueError):
            _validate_request(
                {
                    "url": "https://example.com",
                    "userId": "user123",
                    "crawlDepth": MIN_DEPTH - 1,
                }
            )

        with self.assertRaises(ValueError):
            _validate_request(
                {
                    "url": "https://example.com",
                    "userId": "user123",
                    "crawlDepth": MAX_DEPTH + 1,
                }
            )

    def test_validate_request_rejects_read_only_kb(self):
        """Read-only KBs should not be accepted as crawl targets."""
        with self.assertRaises(ValueError):
            _validate_request(
                {
                    "url": "https://example.com",
                    "userId": "user123",
                    "kbId": "numa-support",
                }
            )

    @patch("lambda_function._validate_request")
    def test_handler_validation_error(self, mock_validate):
        """Test handler handles validation errors"""
        mock_validate.return_value = None

        mock_context = MagicMock(spec=LambdaContext)
        result = handler({"url": "invalid"}, mock_context)

        self.assertEqual(result["status"], "error")

    @patch("lambda_function.add_url_to_dynamodb")
    @patch("lambda_function._validate_request")
    def test_handler_success_path(self, mock_validate, mock_add_url):
        """Test happy path through the handler"""

        valid_request = {
            "url": "https://example.com",
            "userId": "user123",
            "crawlDepth": 2,
        }
        mock_validate.return_value = valid_request
        mock_add_url.return_value = {
            "status": "success",
            "message": "URL added to queue",
        }

        mock_context = MagicMock(spec=LambdaContext)
        result = handler(valid_request, mock_context)

        self.assertEqual(result["status"], "success")
        mock_add_url.assert_called_once_with(valid_request)
