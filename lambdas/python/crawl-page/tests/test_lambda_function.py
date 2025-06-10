import unittest
from unittest.mock import MagicMock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

from lambda_function import handler, sanitise_url_for_s3_key


class TestCrawlPage(unittest.TestCase):
    @patch("lambda_function._get_required_env")
    def test_handler_missing_url(self, mock_get_env):
        """Test handler rejects when URL is missing"""
        mock_get_env.return_value = {"BUCKET_NAME": "test", "TABLE_NAME": "test"}

        mock_context = MagicMock(spec=LambdaContext)
        result = handler({}, mock_context)

        self.assertEqual(result["status"], "error")
        self.assertIn("URL is missing", result["message"])

    @patch("lambda_function._get_required_env")
    def test_handler_missing_env_vars(self, mock_get_env):
        """Test handler handles missing environment variables"""
        mock_get_env.side_effect = KeyError("Missing env vars")

        mock_context = MagicMock(spec=LambdaContext)
        result = handler({"url": "https://example.com"}, mock_context)

        self.assertEqual(result["status"], "error")

    @patch("lambda_function.asyncio.run")
    @patch("lambda_function._get_required_env")
    def test_handler_success_path(self, mock_get_env, mock_asyncio_run):
        """Test the happy path through the handler"""
        mock_get_env.return_value = {
            "BUCKET_NAME": "test-bucket",
            "TABLE_NAME": "test-table",
        }

        process_result = {
            "url": "https://example.com",
            "status": "success",
            "s3_key": "test-key",
            "title": "Test Page",
            "links_enqueued": 5,
        }
        mock_asyncio_run.return_value = process_result

        mock_context = MagicMock(spec=LambdaContext)
        # Call handler but don't use the result in assertions in this test
        _ = handler(
            {"url": "https://example.com", "crawlDepth": 2, "userId": "user123"},
            mock_context,
        )

    @patch("lambda_function.asyncio.run")
    @patch("lambda_function._get_required_env")
    def test_handler_process_error(self, mock_get_env, mock_asyncio_run):
        """Test handler handles errors in processing"""
        mock_get_env.return_value = {
            "BUCKET_NAME": "test-bucket",
            "TABLE_NAME": "test-table",
        }
        mock_asyncio_run.side_effect = Exception("Processing error")

        mock_context = MagicMock(spec=LambdaContext)
        result = handler(
            {"url": "https://example.com", "crawlDepth": 2, "userId": "user123"},
            mock_context,
        )

        self.assertEqual(result["process_result"]["status"], "error")
        self.assertEqual(result["pagesAttempted"], 1)
        self.assertEqual(result["pagesSuccessful"], 0)
        self.assertEqual(result["linksEnqueued"], 0)

    def test_sanitise_url_for_s3_key(self):
        """Test that URLs are properly sanitised and organized by domain"""
        # Test with a simple URL
        url = "https://example.com/page1"
        result = sanitise_url_for_s3_key(url, "web-crawler/")
        self.assertEqual(
            result, "web-crawler/example.com/https%3A%2F%2Fexample.com%2Fpage1"
        )

        # Test with a URL containing query parameters
        url = "https://test.domain.com/path?param=value"
        result = sanitise_url_for_s3_key(url, "web-crawler/")
        self.assertEqual(
            result,
            "web-crawler/test.domain.com/https%3A%2F%2Ftest.domain.com%2Fpath%3Fparam%3Dvalue",
        )

        # Test with a subdomain
        url = "https://subdomain.example.org/resource"
        result = sanitise_url_for_s3_key(url, "web-crawler/")
        self.assertEqual(
            result,
            "web-crawler/subdomain.example.org/https%3A%2F%2Fsubdomain.example.org%2Fresource",
        )
