# pylint: disable=wrong-import-position
"""
Main test file for Claude Code Agent Lambda.

This file imports and runs all test modules for the refactored structure:
- test_utils: Tests for shared utility functions
- test_router: Tests for the main router
- test_data_analysis: Tests for data analysis agent (future)
- test_default: Tests for default agent (future)

Run all tests with: poetry run python -m unittest
Or run specific module: poetry run python -m unittest tests.test_utils
"""

import sys
import unittest
from unittest import mock

# Stub modules that may not be available in test environment
sys.modules.setdefault("helpers", mock.MagicMock())
sys.modules.setdefault("s3_helpers", mock.MagicMock())
sys.modules.setdefault("structlog", mock.MagicMock())
sys.modules.setdefault("aws_lambda_powertools", mock.MagicMock())
sys.modules.setdefault("aws_lambda_powertools.utilities", mock.MagicMock())
sys.modules.setdefault("aws_lambda_powertools.utilities.typing", mock.MagicMock())

from tests.test_router import TestRouter, TestRouterConfiguration

# Import all test modules
from tests.test_utils import (
    TestConversation,
    TestS3Operations,
    TestTraceParser,
    TestWorkspace,
)


def load_tests(loader, _tests, _pattern):
    """Load all test suites."""
    suite = unittest.TestSuite()

    # Add all test classes
    suite.addTests(loader.loadTestsFromTestCase(TestS3Operations))
    suite.addTests(loader.loadTestsFromTestCase(TestWorkspace))
    suite.addTests(loader.loadTestsFromTestCase(TestTraceParser))
    suite.addTests(loader.loadTestsFromTestCase(TestConversation))
    suite.addTests(loader.loadTestsFromTestCase(TestRouter))
    suite.addTests(loader.loadTestsFromTestCase(TestRouterConfiguration))

    return suite


if __name__ == "__main__":
    unittest.main()
