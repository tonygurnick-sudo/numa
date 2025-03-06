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

        event = {
            "pathParameters": {},
            "body": json.dumps(
                {"results": {"task1": "result1", "task2": {"status": "COMPLETED"}}}
            ),
        }

        response = create_job.handler(event, None)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertIn("jobID", body)
        self.assertIn("dateTime", body)
        self.assertEqual(body["results"]["task1"], "result1")

        self.table_mock.put_item.assert_called_once()

    @patch("list_jobs.dynamodb")
    def test_list_jobs(self, dynamodb_mock):
        dynamodb_mock.Table.return_value = self.table_mock

        now = datetime.now(timezone.utc).isoformat()
        self.table_mock.scan.return_value = {
            "Items": [
                {
                    "jobID": "job1",
                    "dateTime": now,
                    "results": {"task1": "result1"},
                }
            ]
        }

        event = {
            "pathParameters": {},
            "httpMethod": "GET",
            "queryStringParameters": None,
        }

        response = list_jobs.handler(event, None)

        self.assertEqual(response["statusCode"], 200, response["body"])
        body = json.loads(response["body"])
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["items"][0]["jobID"], "job1")

        self.table_mock.scan.assert_called_once()

    @patch("get_job.dynamodb")
    def test_get_job(self, dynamodb_mock):
        dynamodb_mock.Table.return_value = self.table_mock

        now = datetime.now(timezone.utc).isoformat()
        self.table_mock.get_item.return_value = {
            "Item": {
                "jobID": "job1",
                "appName": "test-app",
                "dateTime": now,
                "results": {"task1": "result1"},
            }
        }

        event = {
            "pathParameters": {"app_id": "test-app", "job_id": "job1"},
            "httpMethod": "GET",
        }

        response = get_job.handler(event, None)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["jobID"], "job1")

        self.table_mock.get_item.assert_called_once()

    @patch("update_job.dynamodb")
    def test_update_job(self, dynamodb_mock):
        dynamodb_mock.Table.return_value = self.table_mock

        event = {
            "pathParameters": {"job_id": "job1"},
            "httpMethod": "PUT",
            "body": json.dumps(
                {
                    "results": {
                        "task1": "updated-result",
                        "task2": {"status": "COMPLETED"},
                    }
                }
            ),
        }

        self.table_mock.update_item.return_value = {}

        response = update_job.handler(event, None)

        self.assertEqual(response["statusCode"], 200, response["body"])
        self.table_mock.update_item.assert_called_once()


if __name__ == "__main__":
    unittest.main()
