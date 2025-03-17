import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Add the parent directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from lambda_function import handler, search_duckduckgo


@pytest.fixture
def lambda_context():
    return MagicMock()


@pytest.fixture
def mock_ddgs_results():
    return [
        {
            "title": "Test Result 1",
            "href": "https://example.com/1",
            "body": "This is the first test result",
        },
        {
            "title": "Test Result 2",
            "href": "https://example.com/2",
            "body": "This is the second test result",
        },
    ]


def test_handler_with_valid_query(lambda_context, mock_ddgs_results):
    # Arrange
    event = {"query": "test query", "max_results": 2}

    # Mock the DDGS class and its text method
    with patch("lambda_function.DDGS") as mock_ddgs:
        mock_ddgs_instance = MagicMock()
        mock_ddgs_instance.text.return_value = mock_ddgs_results
        mock_ddgs.return_value = mock_ddgs_instance

        # Act
        response = handler(event, lambda_context)

        # Assert
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["query"] == "test query"
        assert body["results_count"] == 2
        assert len(body["results"]) == 2
        assert body["results"][0]["title"] == "Test Result 1"
        assert body["results"][0]["url"] == "https://example.com/1"
        assert body["results"][0]["snippet"] == "This is the first test result"


def test_handler_with_empty_query(lambda_context):
    # Arrange
    event = {"query": "", "max_results": 5}

    # Act
    response = handler(event, lambda_context)

    # Assert
    assert response["statusCode"] == 400
    body = json.loads(response["body"])
    assert "error" in body


def test_search_duckduckgo(mock_ddgs_results):
    # Arrange
    query = "test query"
    max_results = 2

    # Mock the DDGS class and its text method
    with patch("lambda_function.DDGS") as mock_ddgs:
        mock_ddgs_instance = MagicMock()
        mock_ddgs_instance.text.return_value = mock_ddgs_results
        mock_ddgs.return_value = mock_ddgs_instance

        # Act
        results = search_duckduckgo(query, max_results)

        # Assert
        assert len(results) == 2
        assert results[0]["title"] == "Test Result 1"
        assert results[0]["url"] == "https://example.com/1"
        assert results[0]["snippet"] == "This is the first test result"


def test_search_duckduckgo_exception():
    # Arrange
    query = "test query"

    # Mock the DDGS class to raise an exception
    with patch("lambda_function.DDGS") as mock_ddgs:
        mock_ddgs_instance = MagicMock()
        mock_ddgs_instance.text.side_effect = Exception("Test exception")
        mock_ddgs.return_value = mock_ddgs_instance

        # Act & Assert
        with pytest.raises(Exception) as excinfo:
            search_duckduckgo(query)

        assert "Web search failed" in str(excinfo.value)
