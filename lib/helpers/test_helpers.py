import os
import unittest
from unittest.mock import patch

import structlog

import helpers

logger = structlog.getLogger(__name__)


class TestSetupLogging(unittest.TestCase):
    @patch.dict(os.environ, {"APP_NAME": "test-app", "LOG_TO_CONSOLE": "true"})
    def test(self):
        logger.info("before")
        helpers.setup_logging()
        logger.info("after")


if __name__ == "__main__":
    unittest.main()
