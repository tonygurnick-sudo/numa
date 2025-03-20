"""
Tests for the web search proxy lambda function.

This module contains unit tests for the web search proxy,
including tests for the search, scraping, and query rewriting functionality.
"""

import json
import unittest
from unittest.mock import MagicMock, patch

from lambda_function import (
    google_search,
    lambda_handler,
    rewrite_query_with_context,
    scrape_page,
)


class TestWebSearchProxy(unittest.TestCase):
    """
    Test suite for the web search proxy lambda function.

    Tests the main functionality of the lambda handler and its supporting functions.
    """

    @patch("lambda_function.google_search")
    @patch("lambda_function.scrape_page")
    @patch("lambda_function.helpers.setup_step_function_lambda_logging")
    def test_lambda_handler_successful_search(
        self, mock_logging, mock_scrape, mock_google
    ):  # pylint: disable=unused-argument
        """Test successful search and content scraping."""
        # Setup mocks
        mock_google.return_value = ["http://example.com", "http://example2.com"]
        mock_scrape.side_effect = [
            {
                "title": "Example 1",
                "url": "http://example.com",
                "snippet": "This is sample content 1",
            },
            {
                "title": "Example 2",
                "url": "http://example2.com",
                "snippet": "This is sample content 2",
            },
        ]

        # Test data
        event = {
            "httpMethod": "GET",
            "queryStringParameters": {"query": "test query", "max_results": "2"},
            "app_id": "test-app",
        }
        context = MagicMock()

        # Execute function
        response = lambda_handler(event, context)

        # Assertions
        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["query"], "test query")
        self.assertEqual(body["results_count"], 2)
        self.assertEqual(len(body["results"]), 2)
        self.assertEqual(body["results"][0]["title"], "Example 1")
        self.assertEqual(body["results"][1]["title"], "Example 2")

        # Verify mocks were called correctly
        mock_google.assert_called_once_with("test query", 2)
        self.assertEqual(mock_scrape.call_count, 2)

    @patch("lambda_function.rewrite_query_with_context")
    @patch("lambda_function.google_search")
    @patch("lambda_function.scrape_page")
    @patch("lambda_function.helpers.setup_step_function_lambda_logging")
    def test_lambda_handler_with_context(
        self, mock_logging, mock_scrape, mock_google, mock_rewrite
    ):  # pylint: disable=unused-argument
        """Test search with conversation context for query rewriting."""
        # Setup mocks
        mock_rewrite.return_value = "rewritten query"
        mock_google.return_value = ["http://example.com"]
        mock_scrape.return_value = {
            "title": "Example",
            "url": "http://example.com",
            "snippet": "This is sample content",
        }

        # Test data
        event = {
            "httpMethod": "GET",
            "queryStringParameters": {
                "query": "original query",
                "context": "some conversation context",
            },
            "app_id": "test-app",
        }
        context = MagicMock()

        # Execute function
        response = lambda_handler(event, context)

        # Assertions
        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["query"], "rewritten query")
        self.assertEqual(body["original_query"], "original query")

        # Verify mocks were called correctly
        mock_rewrite.assert_called_once_with(
            "original query", "some conversation context"
        )
        mock_google.assert_called_once_with("rewritten query", 5)

    @patch("lambda_function.helpers.setup_step_function_lambda_logging")
    def test_lambda_handler_missing_query(
        self, mock_logging
    ):  # pylint: disable=unused-argument
        """Test handling of missing query parameter."""
        # Test data
        event = {"httpMethod": "GET", "queryStringParameters": {}, "app_id": "test-app"}
        context = MagicMock()

        # Execute function
        response = lambda_handler(event, context)

        # Assertions
        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertEqual(body["error"], "Missing query parameter")

    @patch("lambda_function.helpers.setup_step_function_lambda_logging")
    def test_lambda_handler_options_request(
        self, mock_logging
    ):  # pylint: disable=unused-argument
        """Test handling of OPTIONS requests for CORS preflight."""
        # Test data
        event = {
            "httpMethod": "OPTIONS",
            "app_id": "test-app",  # Add app_id to prevent KeyError
        }
        context = MagicMock()

        # Execute function
        response = lambda_handler(event, context)

        # Assertions
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["body"], "")

    @patch("lambda_function.search")
    def test_google_search_success(self, mock_search):
        # Setup mock
        mock_search.return_value = ["http://example.com", "http://example2.com"]

        # Execute function
        result = google_search("test query", 2)

        # Assertions
        self.assertEqual(len(result), 2)
        self.assertEqual(result, ["http://example.com", "http://example2.com"])

        # Verify mock was called correctly
        mock_search.assert_called_once()

    @patch("lambda_function.search")
    def test_google_search_exception(self, mock_search):
        # Setup mock
        mock_search.side_effect = Exception("Search failed")

        # Execute function
        result = google_search("test query")

        # Assertions
        self.assertEqual(result, [])

    @patch("lambda_function.httpx.get")
    def test_scrape_page_success(self, mock_get):
        # Setup mock
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><head><title>Test Page</title></head><body>Test content</body></html>"
        mock_get.return_value = mock_response

        # Execute function
        result = scrape_page("http://example.com")

        # Assertions
        self.assertEqual(result["title"], "Test Page")
        self.assertEqual(result["url"], "http://example.com")
        # The BeautifulSoup get_text combines all text content including title
        self.assertEqual(result["snippet"], "Test Page Test content")

    @patch("lambda_function.httpx.get")
    def test_scrape_page_non_200_status(self, mock_get):
        # Setup mock
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_get.return_value = mock_response

        # Execute function
        result = scrape_page("http://example.com")

        # Assertions
        self.assertEqual(result["title"], "")
        self.assertEqual(result["url"], "http://example.com")
        self.assertEqual(result["snippet"], "")

    @patch("lambda_function.httpx.get")
    def test_scrape_page_exception(self, mock_get):
        # Setup mock
        mock_get.side_effect = Exception("Connection error")

        # Execute function
        result = scrape_page("http://example.com")

        # Assertions
        self.assertEqual(result["title"], "")
        self.assertEqual(result["url"], "http://example.com")
        self.assertEqual(result["snippet"], "")

    @patch("lambda_function.bedrock.BedrockClaude3Model")
    def test_rewrite_query_with_context_success(self, mock_bedrock_model):
        # Setup mock
        mock_model_instance = MagicMock()
        mock_response = MagicMock()
        mock_response.response = [{"text": "rewritten query"}]
        mock_model_instance.run.return_value = mock_response
        mock_bedrock_model.return_value = mock_model_instance

        # Execute function
        result = rewrite_query_with_context("original query", "some context")

        # Assertions
        self.assertEqual(result, "rewritten query")

        # Verify mocks were called correctly
        mock_bedrock_model.assert_called_once()
        mock_model_instance.run.assert_called_once()

    @patch("lambda_function.bedrock.BedrockClaude3Model")
    def test_rewrite_query_empty_response(self, mock_bedrock_model):
        # Setup mock
        mock_model_instance = MagicMock()
        mock_response = MagicMock()
        mock_response.response = [{"text": ""}]
        mock_model_instance.run.return_value = mock_response
        mock_bedrock_model.return_value = mock_model_instance

        # Execute function
        result = rewrite_query_with_context("original query", "some context")

        # Assertions
        self.assertEqual(result, "original query")

    @patch("lambda_function.bedrock.BedrockClaude3Model")
    def test_rewrite_query_exception(self, mock_bedrock_model):
        # Setup mock
        mock_model_instance = MagicMock()
        mock_model_instance.run.side_effect = Exception("Model error")
        mock_bedrock_model.return_value = mock_model_instance

        # Execute function
        result = rewrite_query_with_context("original query", "some context")

        # Assertions
        self.assertEqual(result, "original query")
