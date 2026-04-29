import json
import os
from unittest import TestCase, mock

from aws_lambda_powertools.utilities.data_classes import APIGatewayProxyEvent

import lambda_function


class TestWebCrawlerStart(TestCase):
    def setUp(self):
        self.env_patcher = mock.patch.dict(
            os.environ,
            {
                "WEB_CRAWLER_STATE_MACHINE_ARN": "arn:aws:states:us-east-1:123456789012:stateMachine:TestStateMachine",
                "CRAWL_URLS_TABLE_NAME": "numa-test-crawl-urls",
            },
        )
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()

    @mock.patch("lambda_function.step_function_client")
    def test_handler_success(self, mock_step_function_client):
        # Mock the step function client response
        mock_step_function_client.start_execution.return_value = {
            "executionArn": "arn:aws:states:us-east-1:123456789012:execution:TestStateMachine:execution-id",
            "startDate": "2023-05-01T12:00:00.000Z",
        }

        # Create a mock API Gateway event
        event = APIGatewayProxyEvent(
            {
                "body": json.dumps(
                    {
                        "urls": ["https://example.com", "https://example.org"],
                        "maxPages": 100,
                        "maxDepth": 2,
                        "userId": "test-user-id",
                    }
                ),
                "requestContext": {
                    "authorizer": {
                        "claims": {
                            "sub": "test-user-id",
                        }
                    }
                },
            }
        )

        # Call the handler
        response = lambda_function.handler(event, None)

        # Verify the response
        self.assertEqual(response["statusCode"], 200)
        self.assertIn("success", json.loads(response["body"]))
        self.assertTrue(json.loads(response["body"])["success"])

        # Check that the step function client was called correctly
        mock_step_function_client.start_execution.assert_called_once()
        call_kwargs = mock_step_function_client.start_execution.call_args[1]
        self.assertEqual(
            call_kwargs["stateMachineArn"],
            "arn:aws:states:us-east-1:123456789012:stateMachine:TestStateMachine",
        )
        input_data = json.loads(call_kwargs["input"])
        self.assertEqual(len(input_data["urls"]), 2)
        self.assertEqual(input_data["userId"], "test-user-id")
        self.assertEqual(input_data["maxPages"], 10000)
        self.assertEqual(input_data["maxDepth"], 2)

    @mock.patch("lambda_function.step_function_client")
    def test_handler_no_urls(self, mock_step_function_client):
        # Create a mock API Gateway event with no URLs
        event = APIGatewayProxyEvent(
            {
                "body": json.dumps(
                    {
                        "urls": [],
                        "maxPages": 100,
                        "maxDepth": 2,
                        "userId": "test-user-id",
                    }
                ),
                "requestContext": {
                    "authorizer": {
                        "claims": {
                            "sub": "test-user-id",
                        }
                    }
                },
            }
        )

        # Call the handler
        response = lambda_function.handler(event, None)

        # Verify the response
        self.assertEqual(response["statusCode"], 400)
        self.assertIn("error", json.loads(response["body"]))
        self.assertEqual(json.loads(response["body"])["error"], "No URLs provided")

        # Check that the step function client was not called
        mock_step_function_client.start_execution.assert_not_called()

    @mock.patch("lambda_function.step_function_client")
    def test_handler_rejects_read_only_kb(self, mock_step_function_client):
        event = APIGatewayProxyEvent(
            {
                "body": json.dumps(
                    {
                        "urls": ["https://example.com"],
                        "kb_id": "numa-support",
                        "userId": "test-user-id",
                    }
                ),
                "requestContext": {
                    "authorizer": {
                        "claims": {
                            "sub": "test-user-id",
                        }
                    }
                },
            }
        )

        response = lambda_function.handler(event, None)
        payload = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 403)
        self.assertFalse(payload["success"])
        self.assertIn("Read-only folder", payload["error"])
        mock_step_function_client.start_execution.assert_not_called()

    @mock.patch("lambda_function.step_function_client")
    def test_handler_url_depth_map(self, mock_step_function_client):
        # Mock the step function client response
        mock_step_function_client.start_execution.return_value = {
            "executionArn": "arn:aws:states:us-east-1:123456789012:execution:TestStateMachine:execution-id",
            "startDate": "2023-05-01T12:00:00.000Z",
        }

        # Create a mock API Gateway event with URL-specific depths
        event = APIGatewayProxyEvent(
            {
                "body": json.dumps(
                    {
                        "urls": ["https://example.com", "https://example.org"],
                        "maxPages": 100,
                        "maxDepth": 2,
                        "userId": "test-user-id",
                        "urlDepthMap": {
                            "https://example.com": 3,
                            "https://example.org": 4,
                        },
                    }
                ),
                "requestContext": {
                    "authorizer": {
                        "claims": {
                            "sub": "test-user-id",
                        }
                    }
                },
            }
        )

        # Call the handler
        response = lambda_function.handler(event, None)

        # Verify the response
        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(json.loads(response["body"])["success"])

        # Check that the step function client was called correctly
        mock_step_function_client.start_execution.assert_called_once()
        call_kwargs = mock_step_function_client.start_execution.call_args[1]
        input_data = json.loads(call_kwargs["input"])

        # Check that URL-specific depths are used
        urls_with_depths = input_data["urls"]
        self.assertEqual(len(urls_with_depths), 2)

        # Find each URL and check its crawl depth
        url1 = next(
            (u for u in urls_with_depths if u["url"] == "https://example.com"), None
        )
        url2 = next(
            (u for u in urls_with_depths if u["url"] == "https://example.org"), None
        )

        self.assertIsNotNone(url1)
        self.assertIsNotNone(url2)
        if url1 is not None:
            self.assertEqual(url1["crawlDepth"], 3)
        if url2 is not None:
            self.assertEqual(url2["crawlDepth"], 4)

    @mock.patch("lambda_function.step_function_client")
    def test_handler_exception(self, mock_step_function_client):
        # Mock the step function client to raise an exception
        mock_step_function_client.start_execution.side_effect = Exception(
            "Test exception"
        )

        # Create a mock API Gateway event
        event = APIGatewayProxyEvent(
            {
                "body": json.dumps(
                    {
                        "urls": ["https://example.com"],
                        "maxPages": 100,
                        "maxDepth": 2,
                        "userId": "test-user-id",
                    }
                ),
                "requestContext": {
                    "authorizer": {
                        "claims": {
                            "sub": "test-user-id",
                        }
                    }
                },
            }
        )

        # Call the handler
        response = lambda_function.handler(event, None)

        # Verify the response
        self.assertEqual(response["statusCode"], 500)
        self.assertIn("error", json.loads(response["body"]))
        self.assertEqual(
            json.loads(response["body"])["error"], "Failed to start web crawler"
        )

    @mock.patch("lambda_function.dynamodb")
    def test_handler_stats_success(self, mock_dynamodb):
        mock_table = mock.Mock()
        mock_dynamodb.Table.return_value = mock_table
        mock_table.query.return_value = {
            "Items": [
                {
                    "url": "https://example.com/page1",
                    "status": "completed",
                    "updatedAt": "2024-01-01T00:00:00Z",
                },
                {
                    "url": "https://example.com/page2",
                    "status": "completed",
                    "updatedAt": "2024-01-02T00:00:00Z",
                },
                {
                    "url": "https://example.org/page1",
                    "status": "completed",
                    "createdAt": "2024-01-03T00:00:00Z",
                },
            ],
            "Count": 3,
        }

        event = APIGatewayProxyEvent(
            {
                "requestContext": {"http": {"method": "GET"}},
                "queryStringParameters": {"kb_id": "company", "limit": "10"},
            }
        )

        response = lambda_function.handler(event, None)
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(body["success"])
        self.assertEqual(body["count"], 3)

        domains = {d["domain"]: d for d in body["domains"]}
        self.assertIn("example.com", domains)
        self.assertIn("example.org", domains)
        self.assertEqual(domains["example.com"]["pageCount"], 2)
        self.assertEqual(domains["example.com"]["lastCrawled"], "2024-01-02T00:00:00Z")
        self.assertEqual(domains["example.org"]["pageCount"], 1)

    @mock.patch("lambda_function.dynamodb")
    def test_handler_stats_rejects_read_only_kb(self, mock_dynamodb):
        event = APIGatewayProxyEvent(
            {
                "requestContext": {"http": {"method": "GET"}},
                "queryStringParameters": {"kb_id": "numa-support", "limit": "10"},
            }
        )

        response = lambda_function.handler(event, None)
        payload = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 403)
        self.assertFalse(payload["success"])
        self.assertIn("Read-only folder", payload["error"])
        mock_dynamodb.Table.assert_not_called()
