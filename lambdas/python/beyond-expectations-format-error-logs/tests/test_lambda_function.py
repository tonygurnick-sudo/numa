import datetime
import json
import unittest
from unittest.mock import MagicMock, patch

from lambda_function import (
    DEFAULT_CHUNK_SIZE,
    DEFAULT_TIME_WINDOW,
    MAX_MESSAGE_LENGTH,
    MAX_TASK_DESCRIPTION_LENGTH,
    group_logs_by_content,
    handler,
    parse_time_window,
    truncate_log_entry,
)


class TestTruncateLogEntry(unittest.TestCase):
    def test_truncate_message_when_too_long(self):
        """Test that long messages are truncated"""
        long_message = "x" * (MAX_MESSAGE_LENGTH + 100)
        log_entry = {"Message": long_message, "TaskDescription": "test"}

        result = truncate_log_entry(log_entry)

        self.assertTrue(result["Message"].endswith("... [TRUNCATED]"))
        self.assertEqual(
            len(result["Message"]), MAX_MESSAGE_LENGTH + len("... [TRUNCATED]")
        )
        self.assertEqual(result["TaskDescription"], "test")

    def test_truncate_task_description_when_too_long(self):
        """Test that long task descriptions are truncated"""
        long_task_desc = "x" * (MAX_TASK_DESCRIPTION_LENGTH + 100)
        log_entry = {"Message": "test", "TaskDescription": long_task_desc}

        result = truncate_log_entry(log_entry)

        self.assertEqual(result["Message"], "test")
        self.assertTrue(result["TaskDescription"].endswith("... [TRUNCATED]"))
        self.assertEqual(
            len(result["TaskDescription"]),
            MAX_TASK_DESCRIPTION_LENGTH + len("... [TRUNCATED]"),
        )

    def test_no_truncation_when_within_limits(self):
        """Test that short messages and task descriptions are not truncated"""
        log_entry = {"Message": "short message", "TaskDescription": "short task"}

        result = truncate_log_entry(log_entry)

        self.assertEqual(result["Message"], "short message")
        self.assertEqual(result["TaskDescription"], "short task")

    def test_missing_fields_handled_gracefully(self):
        """Test that missing Message or TaskDescription fields don't cause errors"""
        log_entry = {"SomeOtherField": "value"}

        result = truncate_log_entry(log_entry)

        self.assertEqual(result["SomeOtherField"], "value")
        self.assertNotIn("Message", result)
        self.assertNotIn("TaskDescription", result)


class TestGroupLogsByContent(unittest.TestCase):
    def test_deduplication_with_same_content(self):
        """Test that logs with same content are deduplicated"""
        logs = [
            {
                "DateTimeUtc": "2024-01-01T10:00:00Z",
                "ClientId": "client1",
                "TaskDescription": "task1",
                "Message": "error1",
            },
            {
                "DateTimeUtc": "2024-01-01T11:00:00Z",
                "ClientId": "client1",
                "TaskDescription": "task1",
                "Message": "error1",
            },
            {
                "DateTimeUtc": "2024-01-01T12:00:00Z",
                "ClientId": "client1",
                "TaskDescription": "task2",
                "Message": "error2",
            },
        ]

        result = group_logs_by_content(logs)

        self.assertEqual(len(result), 2)

        # Find the duplicated log
        duplicated_log = next(log for log in result if log["occurrences"] == 2)
        self.assertEqual(duplicated_log["TaskDescription"], "task1")
        self.assertEqual(duplicated_log["Message"], "error1")
        self.assertEqual(duplicated_log["first_occurrence"], "2024-01-01T10:00:00Z")
        self.assertEqual(duplicated_log["last_occurrence"], "2024-01-01T11:00:00Z")

        # Find the unique log
        unique_log = next(log for log in result if log["occurrences"] == 1)
        self.assertEqual(unique_log["TaskDescription"], "task2")
        self.assertEqual(unique_log["Message"], "error2")

    def test_chronological_ordering_maintained(self):
        """Test that logs are processed chronologically"""
        logs = [
            {
                "DateTimeUtc": "2024-01-01T12:00:00Z",
                "ClientId": "client1",
                "TaskDescription": "task1",
                "Message": "error1",
            },
            {
                "DateTimeUtc": "2024-01-01T10:00:00Z",
                "ClientId": "client1",
                "TaskDescription": "task1",
                "Message": "error1",
            },
        ]

        result = group_logs_by_content(logs)

        self.assertEqual(len(result), 1)
        grouped_log = result[0]
        self.assertEqual(grouped_log["occurrences"], 2)
        self.assertEqual(grouped_log["first_occurrence"], "2024-01-01T10:00:00Z")
        self.assertEqual(grouped_log["last_occurrence"], "2024-01-01T12:00:00Z")

    def test_logs_without_timestamp_skipped(self):
        """Test that logs without DateTimeUtc are skipped"""
        logs = [
            {"ClientId": "client1", "TaskDescription": "task1", "Message": "error1"},
            {
                "DateTimeUtc": "2024-01-01T10:00:00Z",
                "ClientId": "client1",
                "TaskDescription": "task2",
                "Message": "error2",
            },
        ]

        result = group_logs_by_content(logs)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["TaskDescription"], "task2")


class TestParseTimeWindow(unittest.TestCase):
    def test_valid_time_window(self):
        """Test parsing valid time window strings"""
        self.assertEqual(parse_time_window("24h"), 24)
        self.assertEqual(parse_time_window("1h"), 1)
        self.assertEqual(parse_time_window("168h"), 168)

    def test_invalid_format_raises_error(self):
        """Test that invalid formats raise ValueError"""
        with self.assertRaises(ValueError):
            parse_time_window("24")

        with self.assertRaises(ValueError):
            parse_time_window("24m")

        with self.assertRaises(ValueError):
            parse_time_window("invalid")

    def test_non_numeric_hours_raises_error(self):
        """Test that non-numeric hours raise ValueError"""
        with self.assertRaises(ValueError):
            parse_time_window("abch")


class TestHandler(unittest.TestCase):
    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.helpers")
    def test_handler_basic_functionality(self, mock_helpers, mock_s3):
        """Test the main handler function"""
        # Mock event
        event = {
            "timeWindow": "1h",
            "errorPrefix": "error_logs/",
            "outputPrefix": "output_logs/",
            "chunkSize": 2,
        }

        # Mock context
        context = MagicMock()

        # Mock S3 operations
        mock_s3.list_objects.return_value = [
            "error_logs/2024-01-01-23-00-00.json",
            "error_logs/2024-01-01-22-00-00.json",
        ]

        mock_log_data = {
            "logs": [
                {
                    "DateTimeUtc": "2024-01-01T23:00:00Z",
                    "ClientId": "client1",
                    "TaskDescription": "task1",
                    "Message": "error1",
                },
                {
                    "DateTimeUtc": "2024-01-01T23:05:00Z",
                    "ClientId": "client1",
                    "TaskDescription": "task1",
                    "Message": "error1",
                },
            ]
        }

        mock_s3.read.return_value = json.dumps(mock_log_data).encode("utf-8")

        # Execute handler
        with patch("datetime.datetime") as mock_datetime:
            mock_datetime.utcnow.return_value = datetime.datetime(2024, 1, 2, 0, 0, 0)
            mock_datetime.timedelta = datetime.timedelta

            result = handler(event, context)

        # Verify setup was called
        mock_helpers.setup_step_function_lambda_logging.assert_called_once_with(
            event, context
        )

        # Verify S3 operations
        mock_s3.list_objects.assert_called_once_with(prefix="error_logs/")
        self.assertEqual(mock_s3.read.call_count, 2)

        # Verify output
        self.assertIn("chunkPrefix", result)
        self.assertTrue(result["chunkPrefix"].startswith("output_logs/"))

        # Verify chunk files were written
        self.assertTrue(mock_s3.write.called)

    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.helpers")
    def test_handler_with_defaults(self, mock_helpers, mock_s3):
        """Test handler with default values"""
        event = {"errorPrefix": "error_logs/", "outputPrefix": "output_logs/"}
        context = MagicMock()

        mock_s3.list_objects.return_value = []

        with patch("datetime.datetime") as mock_datetime:
            mock_datetime.utcnow.return_value = datetime.datetime(2024, 1, 2, 0, 0, 0)
            mock_datetime.timedelta = datetime.timedelta

            result = handler(event, context)

        # Verify defaults were used
        mock_s3.list_objects.assert_called_once_with(prefix="error_logs/")
        self.assertIn("chunkPrefix", result)

    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.helpers")
    def test_handler_error_handling(self, mock_helpers, mock_s3):
        """Test handler handles S3 read errors gracefully"""
        event = {
            "timeWindow": "1h",
            "errorPrefix": "error_logs/",
            "outputPrefix": "output_logs/",
            "chunkSize": 10,
        }
        context = MagicMock()

        mock_s3.list_objects.return_value = ["error_logs/2024-01-01-23-00-00.json"]
        mock_s3.read.side_effect = Exception("S3 read error")

        with patch("datetime.datetime") as mock_datetime:
            mock_datetime.utcnow.return_value = datetime.datetime(2024, 1, 2, 0, 0, 0)
            mock_datetime.timedelta = datetime.timedelta

            # Should not raise an exception
            result = handler(event, context)

        # Should still return a result even with errors
        self.assertIn("chunkPrefix", result)


if __name__ == "__main__":
    unittest.main()
