"""
E2E test Lambda function that simulates a long-running job.
This module provides functionality to test polling and job creation by waiting
for a specified period before completing.
"""

import json
import logging
import time

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, _context):
    """
    Simple E2E test Lambda that waits for 30 seconds before completing.
    This is used to test polling and job creation functionality.

    Args:
        event: Lambda event data
        _context: Lambda context (unused)

    Returns:
        Dictionary with status and message
    """
    logger.info("E2E Test Lambda started with event: %s", json.dumps(event))

    job_id = event.get("job_id", "unknown")
    logger.info("Processing job: %s", job_id)

    # Wait for 30 seconds
    logger.info("Starting 30-second wait period...")
    time.sleep(30)
    logger.info("30-second wait period completed")

    result = {
        "results": [
            {
                "input_reference": None,
                "outputs": [
                    {
                        "content_type": "application/json",
                        "data": {
                            "message": (
                                "E2E test completed successfully " "after 30 seconds"
                            )
                        },
                        "location": "inline",
                        "title": "E2E Test",
                    }
                ],
            }
        ]
    }

    logger.info("Returning result: %s", json.dumps(result))
    return result
