import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import create_job
import get_job
import list_jobs
import update_job


class TestLambdaFunction(unittest.TestCase):
    def setUp(self):
        self.table_mock = MagicMock()
        os.environ["DYNAMODB_TABLE"] = "test-table"

    @patch("create_job.dynamodb")
    def test_create_job(self, dynamodb_mock):
        dynamodb_mock.Table.return_value = self.table_mock

        # Mock the put_item response
        self.table_mock.put_item.return_value = {}

        event = {
            "pathParameters": {},
            "body": json.dumps(
                {
                    "appName": "test-app",
                    "userId": "test-user-123",
                    "results": {"task1": "result1", "task2": {"status": "COMPLETED"}},
                }
            ),
        }

        response = create_job.handler(event, None)

        self.assertEqual(response["statusCode"], 201)
        body = json.loads(response["body"])
        self.assertIn("jobId", body)
        self.assertIn("dateTime", body)
        self.assertEqual(body["results"]["task1"], "result1")
        self.assertTrue(body.get("name"))

        self.table_mock.put_item.assert_called_once()

    @patch("list_jobs.dynamodb")
    def test_list_jobs(self, dynamodb_mock):
        dynamodb_mock.Table.return_value = self.table_mock

        now = datetime.now(timezone.utc).isoformat()
        # Mock query to return a real dict
        self.table_mock.query.return_value = {
            "Items": [
                {
                    "jobId": "job1",
                    "userId": "test-user-123",
                    "appName": "test-app",
                    "dateTime": now,
                    "results": {"task1": "result1"},
                }
            ],
            "LastEvaluatedKey": None,
        }

        event = {
            "pathParameters": {},
            "httpMethod": "GET",
            "queryStringParameters": {"userId": "test-user-123"},
        }

        response = list_jobs.handler(event, None)

        self.assertEqual(response["statusCode"], 200, response["body"])
        body = json.loads(response["body"])
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["jobId"], "job1")

        # Accept either query or scan as valid, depending on code path
        self.assertTrue(
            self.table_mock.query.called or self.table_mock.scan.called,
            "Neither query nor scan was called on the table mock",
        )

    @patch("get_job.dynamodb")
    def test_get_job(self, dynamodb_mock):
        dynamodb_mock.Table.return_value = self.table_mock

        now = datetime.now(timezone.utc).isoformat()
        self.table_mock.get_item.return_value = {
            "Item": {
                "jobId": "job1",
                "userId": "test-user-123",
                "appName": "test-app",
                "dateTime": now,
                "results": {"task1": "result1"},
            }
        }

        event = {
            "pathParameters": {"jobId": "job1"},
            "httpMethod": "GET",
        }

        response = get_job.handler(event, None)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["jobId"], "job1")

        self.table_mock.get_item.assert_called_once()

    @patch("update_job.dynamodb")
    def test_update_job(self, dynamodb_mock):
        dynamodb_mock.Table.return_value = self.table_mock

        event = {
            "pathParameters": {"jobId": "job1"},
            "httpMethod": "PUT",
            "body": json.dumps(
                {
                    "results": {"task1": "updated"},
                    "status": "COMPLETED",
                    "name": "   ",
                }
            ),
        }

        self.table_mock.update_item.return_value = {}

        response = update_job.handler(event, None)

        self.assertEqual(response["statusCode"], 200, response["body"])
        self.table_mock.update_item.assert_called_once()

        call_kwargs = self.table_mock.update_item.call_args.kwargs
        expression_values = call_kwargs.get("ExpressionAttributeValues", {})
        self.assertIn(":name", expression_values)
        self.assertTrue(expression_values[":name"].startswith("Run "))


if __name__ == "__main__":
    unittest.main()
