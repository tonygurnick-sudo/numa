import json
import os
import os.path
import sys
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

# Add the lib directory to the Python path to find the required modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))

# Mock the helpers module before importing lambda_function
sys.modules["helpers"] = Mock()
sys.modules["helpers"].extract_user_id_from_token = Mock(return_value="test-user-id")  # type: ignore

# pylint: disable=wrong-import-position
import lambda_function


class TestShouldIgnoreLog(unittest.TestCase):
    def test_should_ignore_log_by_client_task(self):
        """Test log filtering by client ID and task description"""
        config = {
            "logsToIgnore": {
                "byClientTask": [{"ClientId": 12345, "TaskDescription": "Test Task"}],
                "byMessageContains": [],
            }
        }

        log_entry = {
            "ClientId": 12345,
            "TaskDescription": "Test Task",
            "Message": "Some error message",
        }

        result = lambda_function.should_ignore_log(log_entry, config)
        self.assertTrue(result)

    def test_should_ignore_log_by_message_content(self):
        """Test log filtering by message content"""
        config = {
            "logsToIgnore": {
                "byClientTask": [],
                "byMessageContains": ["timeout", "connection reset"],
            }
        }

        log_entry = {
            "ClientId": 67890,
            "TaskDescription": "Different Task",
            "Message": "Connection timeout occurred",
        }

        result = lambda_function.should_ignore_log(log_entry, config)
        self.assertTrue(result)

    def test_should_not_ignore_log(self):
        """Test that logs not matching ignore rules are not filtered"""
        config = {
            "logsToIgnore": {
                "byClientTask": [{"ClientId": 12345, "TaskDescription": "Test Task"}],
                "byMessageContains": ["timeout"],
            }
        }

        log_entry = {
            "ClientId": 67890,
            "TaskDescription": "Different Task",
            "Message": "Critical error occurred",
        }

        result = lambda_function.should_ignore_log(log_entry, config)
        self.assertFalse(result)

    def test_should_ignore_log_empty_config(self):
        """Test with empty ignore configuration"""
        config = {"logsToIgnore": {"byClientTask": [], "byMessageContains": []}}

        log_entry = {
            "ClientId": 12345,
            "TaskDescription": "Any Task",
            "Message": "Any error",
        }

        result = lambda_function.should_ignore_log(log_entry, config)
        self.assertFalse(result)


class TestCheckForCachedAnalysis(unittest.TestCase):
    @patch("lambda_function.s3_helpers")
    def test_check_for_cached_analysis_found(self, mock_s3_helpers):
        """Test finding a cached analysis"""
        # Mock S3 list objects
        mock_s3_helpers.list_objects.return_value = [
            "beyond-expectations/logs_analysed/2025-01-01/chunk-1.json"
        ]

        # Mock cached analysis data
        cached_data = {
            "all_results": [
                {
                    "log_entry": {
                        "ClientId": "12345",
                        "TaskDescription": "Test Task",
                        "Message": "Error occurred\r\nStack trace...",
                    },
                    "error_type": "Database Connection Error",
                    "client_notification": "No",
                    "internal_notification": "Yes",
                }
            ]
        }

        mock_s3_helpers.read.return_value = json.dumps(cached_data).encode("utf-8")

        log_entry = {
            "Id": "new-123",
            "ClientId": "12345",
            "TaskDescription": "Test Task",
            "Message": "Error occurred\r\nDifferent stack trace...",
            "DateTimeUtc": "2025-01-02T10:00:00Z",
        }

        with patch("lambda_function.datetime") as mock_datetime:
            mock_datetime.datetime.utcnow.return_value = datetime(2025, 1, 2)
            mock_datetime.timedelta = timedelta

            result = lambda_function.check_for_cached_analysis(
                log_entry,
                recent_objects=[
                    "beyond-expectations/logs_analysed/2025-01-01/chunk-1.json"
                ],
            )

        self.assertIsNotNone(result)
        if result is not None:
            self.assertTrue(result["recurring"])
            self.assertEqual(result["log_entry"]["id"], "new-123")

    @patch("lambda_function.s3_helpers")
    def test_check_for_cached_analysis_not_found(self, mock_s3_helpers):
        """Test when no cached analysis is found"""
        mock_s3_helpers.list_objects.return_value = []

        log_entry = {
            "ClientId": "12345",
            "TaskDescription": "New Task",
            "Message": "New error message",
        }

        with patch("lambda_function.datetime") as mock_datetime:
            mock_datetime.datetime.utcnow.return_value = datetime(2025, 1, 2)
            mock_datetime.timedelta = timedelta

            result = lambda_function.check_for_cached_analysis(
                log_entry, recent_objects=[]
            )

        self.assertIsNone(result)

    @patch("lambda_function.s3_helpers")
    def test_check_for_cached_analysis_s3_error(self, mock_s3_helpers):
        """Test handling S3 errors gracefully"""
        mock_s3_helpers.list_objects.return_value = [
            "beyond-expectations/logs_analysed/2025-01-01/chunk-1.json"
        ]
        mock_s3_helpers.read.side_effect = Exception("S3 read error")

        log_entry = {
            "ClientId": "12345",
            "TaskDescription": "Test Task",
            "Message": "Error occurred",
        }

        with patch("lambda_function.datetime") as mock_datetime:
            mock_datetime.datetime.utcnow.return_value = datetime(2025, 1, 2)
            mock_datetime.timedelta = timedelta

            result = lambda_function.check_for_cached_analysis(
                log_entry, recent_objects=[]
            )

        self.assertIsNone(result)


class TestAnalyzeLogsWithBedrock(unittest.TestCase):
    @patch("lambda_function.config_utils")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    @patch("lambda_function.bedrock.BedrockClaude3Model")
    def test_analyze_logs_empty_list(self, _mock_bedrock_model, mock_config_utils):
        """Test analyzing empty logs list"""
        mock_config_utils.load_config.return_value = {
            "logsToIgnore": {"byClientTask": [], "byMessageContains": []}
        }

        result = lambda_function.analyze_logs_with_bedrock([])

        self.assertEqual(result["notifications_required"], [])
        self.assertEqual(result["notifications_not_required"], [])
        self.assertEqual(result["error_categories"], {})
        self.assertEqual(result["all_results"], [])

    @patch("lambda_function.config_utils")
    @patch("lambda_function.check_for_cached_analysis")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    @patch("lambda_function.bedrock.BedrockClaude3Model")
    def test_analyze_logs_with_cache_hit(
        self, _mock_bedrock_model, mock_check_cache, mock_config_utils
    ):
        """Test analyzing logs with cache hits"""
        mock_config_utils.load_config.return_value = {
            "logsToIgnore": {"byClientTask": [], "byMessageContains": []}
        }
        mock_config_utils.update_prompt_with_config.return_value = (
            "Updated prompt {log_entries}"
        )

        # Mock cached result
        cached_result = {
            "error_type": "Database Error",
            "client_notification": "Yes",
            "internal_notification": "No",
            "recurring": True,
        }
        mock_check_cache.return_value = cached_result

        logs = [
            {
                "Id": "123",
                "ClientId": "12345",
                "TaskDescription": "Test Task",
                "Message": "Database connection failed",
            }
        ]

        result = lambda_function.analyze_logs_with_bedrock(logs)

        self.assertEqual(len(result["all_results"]), 1)
        self.assertEqual(len(result["notifications_required"]), 1)
        self.assertEqual(result["cache_stats"]["hits"], 1)
        self.assertEqual(result["cache_stats"]["misses"], 0)

    @patch("lambda_function.config_utils")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_analyze_logs_with_filtering(self, mock_config_utils):
        """Test that logs are properly filtered based on config"""
        mock_config_utils.load_config.return_value = {
            "logsToIgnore": {
                "byClientTask": [
                    {"ClientId": "12345", "TaskDescription": "Ignore Task"}
                ],
                "byMessageContains": ["timeout"],
            }
        }

        logs = [
            {
                "Id": "1",
                "ClientId": "12345",
                "TaskDescription": "Ignore Task",
                "Message": "Some error",
            },
            {
                "Id": "2",
                "ClientId": "67890",
                "TaskDescription": "Normal Task",
                "Message": "Connection timeout",
            },
            {
                "Id": "3",
                "ClientId": "67890",
                "TaskDescription": "Normal Task",
                "Message": "Valid error",
            },
        ]

        with patch(
            "lambda_function.check_for_cached_analysis", return_value=None
        ), patch("lambda_function.bedrock") as mock_bedrock:

            mock_model = Mock()
            mock_response = Mock()
            mock_response.response = [
                {
                    "input": {
                        "data": [
                            {
                                "error_type": "Valid Error",
                                "client_notification": "No",
                                "internal_notification": "No",
                            }
                        ]
                    }
                }
            ]
            mock_model.run.return_value = mock_response
            mock_bedrock.BedrockClaude3Model.return_value = mock_model
            mock_config_utils.update_prompt_with_config.return_value = (
                "Updated prompt {log_entries}"
            )

            result = lambda_function.analyze_logs_with_bedrock(logs)

            # Only 1 log should remain after filtering
            self.assertEqual(len(result["all_results"]), 1)
            self.assertEqual(result["cache_stats"]["filtered_logs"], 2)


class TestLambdaHandler(unittest.TestCase):
    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.analyze_logs_with_bedrock")
    @patch("lambda_function.helpers.setup_step_function_lambda_logging")
    def test_handler_success(self, mock_setup_logging, mock_analyze, mock_s3_helpers):
        """Test successful lambda handler execution"""
        # Mock S3 read
        chunk_data = {
            "logs": [{"Id": "123", "ClientId": "12345", "Message": "Test error"}]
        }
        mock_s3_helpers.read.return_value = json.dumps(chunk_data).encode("utf-8")

        # Mock analysis result
        analysis_result = {
            "notifications_required": [],
            "notifications_not_required": [],
            "error_categories": {"Test Error": 1},
            "all_results": [{"error_type": "Test Error"}],
            "cache_stats": {
                "hits": 0,
                "misses": 1,
                "recurring_errors": 0,
                "new_errors": 1,
                "filtered_logs": 0,
            },
        }
        mock_analyze.return_value = analysis_result

        event = {
            "chunkPath": "beyond-expectations/logs_to_analyse/2025-01-01/chunk-1.json",
            "app_id": "test-app-id",
        }
        context = Mock()

        result = lambda_function.handler(event, context)

        self.assertEqual(result["statusCode"], 200)
        self.assertIn("Successfully analyzed log chunk", result["body"]["message"])
        mock_s3_helpers.write.assert_called_once()
        mock_setup_logging.assert_called_once_with(event, context)

    @patch("lambda_function.helpers.setup_step_function_lambda_logging")
    def test_handler_missing_chunk_path(self, _mock_setup_logging):
        """Test handler with missing chunkPath"""
        event = {"app_id": "test-app-id"}
        context = Mock()

        result = lambda_function.handler(event, context)

        self.assertEqual(result["statusCode"], 400)
        self.assertIn("No chunkPath provided", result["error"])

    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.helpers.setup_step_function_lambda_logging")
    def test_handler_s3_error(self, _mock_setup_logging, mock_s3_helpers):
        """Test handler with S3 read error"""
        mock_s3_helpers.read.side_effect = Exception("S3 error")

        event = {
            "chunkPath": "beyond-expectations/logs_to_analyse/2025-01-01/chunk-1.json",
            "app_id": "test-app-id",
        }
        context = Mock()

        result = lambda_function.handler(event, context)

        self.assertEqual(result["statusCode"], 500)
        self.assertEqual(result["error"], "S3 error")


if __name__ == "__main__":
    unittest.main()
