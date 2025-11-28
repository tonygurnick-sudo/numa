import sys
import types
import unittest

# Some utils may import modules that indirectly import 'strands'; stub it defensively
if "strands" not in sys.modules:
    strands_mod = types.ModuleType("strands")

    def _noop_tool_decorator(func=None, **_kwargs):
        if func is None:

            def wrapper(f):
                return f

            return wrapper
        return func

    setattr(strands_mod, "tool", _noop_tool_decorator)
    sys.modules["strands"] = strands_mod

from numa_chat_agent.utils import (  # pylint: disable=wrong-import-position
    extract_preview,
    safe_json_convert,
    truncate_text,
)


class TestUtils(unittest.TestCase):
    """Tests for utility functions"""

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
