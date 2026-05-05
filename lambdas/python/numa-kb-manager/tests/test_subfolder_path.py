"""Unit tests for the subfolder path normalizer used by the create/delete folder endpoints."""

from __future__ import annotations

import unittest

from numa_kb_manager.app import _normalize_subfolder_path


class TestNormalizeSubfolderPath(unittest.TestCase):
    def test_simple_name(self):
        path, err = _normalize_subfolder_path("reports")
        self.assertIsNone(err)
        self.assertEqual(path, "reports")

    def test_nested_path(self):
        path, err = _normalize_subfolder_path("reports/q3/finance")
        self.assertIsNone(err)
        self.assertEqual(path, "reports/q3/finance")

    def test_strips_leading_and_trailing_slashes(self):
        path, err = _normalize_subfolder_path("/reports/q3/")
        self.assertIsNone(err)
        self.assertEqual(path, "reports/q3")

    def test_collapses_surrounding_whitespace(self):
        path, err = _normalize_subfolder_path("  reports/q3  ")
        self.assertIsNone(err)
        self.assertEqual(path, "reports/q3")

    def test_rejects_non_string(self):
        path, err = _normalize_subfolder_path(None)
        self.assertIsNone(path)
        self.assertIn("must be a string", err or "")

    def test_rejects_empty(self):
        path, err = _normalize_subfolder_path("")
        self.assertIsNone(path)
        self.assertIn("required", err or "")

    def test_rejects_only_slashes(self):
        path, err = _normalize_subfolder_path("///")
        self.assertIsNone(path)
        self.assertIn("required", err or "")

    def test_rejects_dot_segment(self):
        path, err = _normalize_subfolder_path("reports/./q3")
        self.assertIsNone(path)
        self.assertIn("invalid segment", err or "")

    def test_rejects_double_dot_traversal(self):
        path, err = _normalize_subfolder_path("reports/../secrets")
        self.assertIsNone(path)
        self.assertIn("invalid segment", err or "")

    def test_rejects_empty_segment(self):
        path, err = _normalize_subfolder_path("reports//q3")
        self.assertIsNone(path)
        self.assertIn("invalid segment", err or "")

    def test_rejects_backslash(self):
        path, err = _normalize_subfolder_path("reports\\q3")
        self.assertIsNone(path)
        self.assertIn("invalid characters", err or "")

    def test_rejects_control_character(self):
        path, err = _normalize_subfolder_path("reports/\x00name")
        self.assertIsNone(path)
        self.assertIn("invalid characters", err or "")

    def test_rejects_segment_too_long(self):
        path, err = _normalize_subfolder_path("a" * 200)
        self.assertIsNone(path)
        self.assertIn("too long", err or "")

    def test_accepts_segment_at_max_length(self):
        path, err = _normalize_subfolder_path("a" * 120)
        self.assertIsNone(err)
        self.assertEqual(path, "a" * 120)

    def test_accepts_unicode_and_spaces(self):
        path, err = _normalize_subfolder_path("My Reports/Études 2024")
        self.assertIsNone(err)
        self.assertEqual(path, "My Reports/Études 2024")


if __name__ == "__main__":
    unittest.main()
