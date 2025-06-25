import datetime
import os
import os.path
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

# Add the lib directory to the Python path to find the helpers module
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))

# Mock the jwt and s3_helpers modules before importing lambda_function
sys.modules["jwt"] = Mock()
sys.modules["s3_helpers"] = Mock()

# pylint: disable=wrong-import-position
from lambda_function import (
    MAX_MESSAGE_LENGTH,
    MAX_TASK_DESCRIPTION_LENGTH,
    extract_timestamp_from_filename,
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
            parse_time_window("invalid")

    def test_non_numeric_hours_raises_error(self):
        """Test that non-numeric hours raise ValueError"""
        with self.assertRaises(ValueError):
            parse_time_window("abch")


class TestHandler(unittest.TestCase):
    @patch("lambda_function.s3_helpers")
    def test_handler_with_defaults(self, mock_s3):
        """Test handler with default values"""
        event = {
            "bucket": "test-output-bucket",  # Output bucket
            "errorBucket": "apical-log-data",  # Error logs bucket
            "errorPrefix": "error-logs/",
            "outputPrefix": "beyond-expectations/logs_to_analyse/",
            "timeWindow": "24h",
            "chunkSize": 50,
            "app_id": "test-app-id",
            "job_id": "test-job-id",
        }
        context = MagicMock()
        mock_s3.list_objects.return_value = []

        with patch("datetime.datetime") as mock_datetime:
            mock_datetime.utcnow.return_value = datetime.datetime(2024, 1, 2, 0, 0, 0)
            mock_datetime.timedelta = datetime.timedelta

            result = handler(event, context)

        # Verify that list_objects was called with the error bucket
        mock_s3.list_objects.assert_called_once_with(
            prefix="error-logs/", bucket="apical-log-data"
        )
        self.assertIn("chunkPrefix", result)


class TestExtractTimestampFromFilename(unittest.TestCase):
    def test_new_filename_format(self):
        """Test parsing new apical log filename format"""
        filename = "2025_05_26_12_00_00 - 2025_05_27_04_27_07.json"
        expected = "2025-05-26-12-00-00"

        result = extract_timestamp_from_filename(filename)

        self.assertEqual(result, expected)

    def test_different_timestamp_values(self):
        """Test parsing with different timestamp values"""
        test_cases = [
            ("2024_12_31_23_59_59 - 2025_01_01_00_00_00.json", "2024-12-31-23-59-59"),
            ("2025_01_01_00_00_00 - 2025_01_01_23_59_59.json", "2025-01-01-00-00-00"),
            ("2023_06_15_14_30_45 - 2023_06_16_08_15_22.json", "2023-06-15-14-30-45"),
        ]

        for filename, expected in test_cases:
            with self.subTest(filename=filename):
                result = extract_timestamp_from_filename(filename)
                self.assertEqual(result, expected)

    def test_filename_without_extension(self):
        """Test parsing filename without .json extension"""
        filename = "2025_05_26_12_00_00 - 2025_05_27_04_27_07"
        expected = "2025-05-26-12-00-00"

        result = extract_timestamp_from_filename(filename)

        self.assertEqual(result, expected)

    def test_invalid_filename_format(self):
        """Test that invalid filename formats are still processed by the current implementation"""
        invalid_filenames = [
            "invalid-format.json",
            "2025-05-26-12-00-00.json",  # Old format
            "incomplete.json",
            "2025_05_26.json",
            "",
        ]

        expected_results = [
            "invalid-format",
            "2025-05-26-12-00-00",
            "incomplete",
            "2025-05-26",
            "",
        ]

        for filename, expected in zip(invalid_filenames, expected_results):
            with self.subTest(filename=filename):
                result = extract_timestamp_from_filename(filename)
                self.assertEqual(result, expected)

    def test_malformed_timestamp_parts(self):
        """Test handling of malformed timestamp parts"""
        invalid_filenames = [
            "invalid_date_here - 2025_05_27_04_27_07.json",
            "2025_05_26_12_00_00 - invalid_end.json",
            "2025_05_26_12_00_00.json",  # Missing end part
        ]

        expected_results = [
            "invalid-date-here",
            "2025-05-26-12-00-00",
            "2025-05-26-12-00-00",
        ]

        for filename, expected in zip(invalid_filenames, expected_results):
            with self.subTest(filename=filename):
                result = extract_timestamp_from_filename(filename)
                self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
