import unittest
from unittest.mock import patch

from numa_chat_agent.utils import (
    extract_preview,
    retry_aurora_operation,
    safe_json_convert,
    truncate_text,
)


class TestUtils(unittest.TestCase):
    """Tests for utility functions"""

    def test_retry_aurora_operation_success_first_try(self):
        """Test retry wrapper with operation succeeding on first try"""

        def successful_operation():
            return "success"

        wrapped_operation = retry_aurora_operation(successful_operation)
        result = wrapped_operation()

        self.assertEqual(result, "success")

    def test_retry_aurora_operation_success_after_retry(self):
        """Test retry wrapper with operation succeeding after Aurora retry"""
        call_count = 0

        def aurora_then_success():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception(
                    "Aurora DB instance is resuming after being auto-paused"
                )
            return "success"

        with patch("numa_chat_agent.utils.time.sleep") as mock_sleep:
            wrapped_operation = retry_aurora_operation(
                aurora_then_success, max_retries=3, retry_delay=1.0
            )
            result = wrapped_operation()

            self.assertEqual(result, "success")
            self.assertEqual(call_count, 2)
            mock_sleep.assert_called_once_with(1.0)

    def test_retry_aurora_operation_non_aurora_error(self):
        """Test retry wrapper with non-Aurora error (should not retry)"""

        def failing_operation():
            raise ValueError("This is not an Aurora error")

        wrapped_operation = retry_aurora_operation(failing_operation)

        with self.assertRaises(ValueError):
            wrapped_operation()

    def test_retry_aurora_operation_max_retries_exceeded(self):
        """Test retry wrapper when max retries are exceeded"""

        def always_aurora_error():
            raise Exception("Aurora DB instance is resuming after being auto-paused")

        with patch("numa_chat_agent.utils.time.sleep"):
            wrapped_operation = retry_aurora_operation(
                always_aurora_error, max_retries=2
            )

            with self.assertRaises(Exception):
                wrapped_operation()

    def test_retry_aurora_operation_different_aurora_errors(self):
        """Test retry wrapper recognizes different Aurora error messages"""
        aurora_errors = [
            "DatabaseResumingException",
            "is resuming after being auto-paused",
            "Aurora DB instance is resuming",
        ]

        for error_msg in aurora_errors:
            call_count = 0

            def aurora_error(
                msg=error_msg,
            ):  # Capture error_msg value as default parameter
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    raise Exception(msg)
                return "success"

            with patch("numa_chat_agent.utils.time.sleep"):
                wrapped_operation = retry_aurora_operation(aurora_error, max_retries=2)
                result = wrapped_operation()

                self.assertEqual(result, "success")
                self.assertEqual(call_count, 2)

    def test_safe_json_convert_serializable_object(self):
        """Test JSON conversion of already serializable objects"""
        serializable_objects = [{"key": "value"}, [1, 2, 3], "string", 123, True, None]

        for obj in serializable_objects:
            result = safe_json_convert(obj)
            self.assertEqual(result, obj)

    def test_safe_json_convert_non_serializable_object(self):
        """Test JSON conversion of non-serializable objects"""

        # Create a non-serializable object
        class NonSerializable:
            def __str__(self):
                return "NonSerializable instance"

        non_serializable = NonSerializable()
        result = safe_json_convert(non_serializable)

        # Should be converted to string
        self.assertEqual(result, "NonSerializable instance")

    def test_safe_json_convert_complex_object(self):
        """Test JSON conversion of complex objects with functions"""

        def test_function():
            return "test"

        result = safe_json_convert(test_function)

        # Should be converted to string representation
        self.assertIsInstance(result, str)
        self.assertIn("function", result)  # type: ignore[arg-type] # Test intentionally checks string conversion of function

    def test_truncate_text_short_text(self):
        """Test text truncation with text shorter than max length"""
        text = "Short text"
        result = truncate_text(text, max_length=100)

        self.assertEqual(result, text)

    def test_truncate_text_long_text(self):
        """Test text truncation with text longer than max length"""
        text = "This is a very long text that should be truncated"
        result = truncate_text(text, max_length=20)

        self.assertEqual(len(result), 20)
        self.assertTrue(result.endswith("..."))
        self.assertEqual(result, "This is a very lo...")

    def test_truncate_text_custom_suffix(self):
        """Test text truncation with custom suffix"""
        text = "This is a long text"
        result = truncate_text(text, max_length=15, suffix="[MORE]")

        self.assertEqual(len(result), 15)
        self.assertTrue(result.endswith("[MORE]"))

    def test_truncate_text_non_string_input(self):
        """Test text truncation with non-string input"""
        result = truncate_text(12345, max_length=3)  # type: ignore[arg-type] # Test intentionally passes non-string to verify error handling

        self.assertEqual(result, "...")

    def test_truncate_text_exact_length(self):
        """Test text truncation with text exactly at max length"""
        text = "12345"
        result = truncate_text(text, max_length=5)

        self.assertEqual(result, text)

    def test_extract_preview_empty_content(self):
        """Test preview extraction from empty content"""
        result = extract_preview("")
        self.assertEqual(result, "(empty)")

        result = extract_preview(None)  # type: ignore[arg-type] # Test intentionally passes None to verify error handling
        self.assertEqual(result, "(empty)")

    def test_extract_preview_normal_content(self):
        """Test preview extraction from normal content"""
        content = "This is normal content without special characters"
        result = extract_preview(content, max_length=20)

        self.assertEqual(result, "This is normal co...")

    def test_extract_preview_with_newlines_and_tabs(self):
        """Test preview extraction with newlines and tabs"""
        content = "Line 1\nLine 2\tTabbed\n\nLine 4"
        result = extract_preview(content)

        # Should replace newlines and tabs with spaces
        self.assertNotIn("\n", result)
        self.assertNotIn("\t", result)
        self.assertEqual(result, "Line 1 Line 2 Tabbed Line 4")

    def test_extract_preview_with_extra_whitespace(self):
        """Test preview extraction removes extra whitespace"""
        content = "Text   with    lots     of      spaces"
        result = extract_preview(content)

        # Should normalize whitespace
        self.assertEqual(result, "Text with lots of spaces")

    def test_extract_preview_mixed_whitespace(self):
        """Test preview extraction with mixed whitespace characters"""
        content = "Text\n\n\twith\r\n  mixed   \t\nwhitespace"
        result = extract_preview(content)

        self.assertEqual(result, "Text with mixed whitespace")


if __name__ == "__main__":
    unittest.main()
