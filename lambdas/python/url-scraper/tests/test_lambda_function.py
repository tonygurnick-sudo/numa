"""Tests for the URL Scraper Lambda function."""

import json
import urllib.parse
from unittest import TestCase
from unittest.mock import MagicMock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

from lambda_function import (
    lambda_handler,
    sanitise_url_for_s3_key,
    scrape_page,
    upload_to_s3,
)


# We don't actually need moto for these tests as we're mocking everything
# Just define a dummy decorator for compatibility
def mock_aws(_):
    """Dummy decorator to replace moto.mock_aws when not available.

    Args:
        _: The AWS service to mock (unused)

    Returns:
        A decorator function that returns the original function unchanged
    """

    def decorator(func):
        return func

    return decorator


class TestUrlScraper(TestCase):
    """Test cases for URL Scraper Lambda function."""

    def test_sanitise_url_for_s3_key(self):
        """Test URL to S3 key conversion."""
        test_cases = [
            # URL, prefix
            ("https://example.com", ""),
            ("https://example.com/path", "docs/"),
            ("https://example.com/path?query=1", "urls/"),
            ("https://example.com/path with spaces", "content/"),
        ]

        for url, prefix in test_cases:
            with self.subTest(url=url, prefix=prefix):
                # Call the actual function
                result = sanitise_url_for_s3_key(url, prefix)

                # The current implementation ensures prefix ends with a slash
                expected_prefix = prefix
                if prefix and not prefix.endswith("/"):
                    expected_prefix += "/"
                elif not prefix:
                    expected_prefix = "/"  # Empty prefix gets a leading slash

                # Verify the result contains the encoded URL
                encoded_url = urllib.parse.quote(url, safe="")
                expected = f"{expected_prefix}{encoded_url}"

                self.assertEqual(result, expected)

    @patch("httpx.get")
    def test_scrape_page_success(self, mock_get):
        """Test successful page scraping."""
        # Mock response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = """
        <html><head><title>Test Page</title></head>
        <body><h1>Hello World</h1></body></html>
        """
        mock_response.headers = {"content-type": "text/html"}
        mock_get.return_value = mock_response

        result = scrape_page("https://example.com")

        self.assertIsNotNone(result)
        # Type checking - ensure result is not None before accessing attributes
        if result is not None:
            self.assertEqual(result["title"], "Test Page")
            self.assertIn("Hello World", result["content"])
            self.assertEqual(result["url"], "https://example.com")

    @patch("lambda_function.s3")
    def test_upload_to_s3(self, mock_s3):
        """Test S3 upload functionality."""
        # Mock the S3 client
        mock_put_object = MagicMock(return_value={"ETag": '"test-etag"'})
        mock_s3.put_object = mock_put_object

        # Test upload
        content = "test content"
        bucket_name = "test-bucket"
        key = "test/file.txt"
        metadata = {"source": "test"}
        url = "https://example.com"

        result = upload_to_s3(content, bucket_name, key, metadata, url)

        # Verify the function returned success
        self.assertTrue(result["success"])

        # Verify S3 put_object was called with the right parameters
        mock_put_object.assert_called_once()
        call_args = mock_put_object.call_args[1]
        self.assertEqual(call_args["Bucket"], bucket_name)
        self.assertEqual(call_args["Key"], key)
        self.assertEqual(call_args["Body"], content)
        self.assertEqual(call_args["Metadata"], metadata)
        self.assertEqual(call_args["Tagging"], "url=https%3A%2F%2Fexample.com")

    def test_lambda_handler_valid_request(self):
        """Test Lambda handler with valid request."""
        event = {
            "urls": ["https://example.com"],
            "bucket": "test-bucket",
            "prefix": "test/",
        }

        with patch("lambda_function.scrape_page") as mock_scrape, patch(
            "lambda_function.upload_to_s3"
        ) as mock_upload:

            # Mock successful scrape and upload
            mock_scrape.return_value = {
                "title": "Test Page",
                "content": "Test content",
                "url": "https://example.com",
                "content_type": "text/html",
                "metadata": {},
            }
            mock_upload.return_value = {"success": True, "message": "Upload successful"}

            # Create a mock LambdaContext for testing
            mock_context = MagicMock(spec=LambdaContext)
            response = lambda_handler(event, mock_context)

            self.assertEqual(response["statusCode"], 200)
            result = json.loads(response["body"])
            self.assertEqual(result["status"], "completed")
            self.assertEqual(len(result["results"]), 1)
            self.assertEqual(result["results"][0]["status"], "success")

    def test_lambda_handler_invalid_request(self):
        """Test Lambda handler with invalid request."""
        # Test missing bucket
        event = {"urls": ["https://example.com"]}
        mock_context = MagicMock(spec=LambdaContext)
        response = lambda_handler(event, mock_context)
        self.assertEqual(response["statusCode"], 400)

        # Test empty URLs
        event = {"urls": [], "bucket": "test-bucket"}
        mock_context = MagicMock(spec=LambdaContext)
        response = lambda_handler(event, mock_context)
        self.assertEqual(response["statusCode"], 400)
