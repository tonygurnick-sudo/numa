"""Placeholder test to ensure CI produces report artifacts."""

import unittest


class TestPlaceholder(unittest.TestCase):
    def test_pass(self) -> None:
        result = 1 + 1
        self.assertEqual(result, 2)
