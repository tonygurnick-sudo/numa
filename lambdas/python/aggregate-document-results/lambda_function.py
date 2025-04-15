import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        input_keys = event["input_keys"]
        key_suffix = event["key_suffix"]

        # Prepare outputs list for individual summaries
        outputs = []

        # Process each summary file
        for key in sorted(input_keys):
            filename = key.split("/")[-1].removesuffix(key_suffix)

            outputs.append(
                {
                    "content_type": "text/markdown",
                    "data": {
                        "bucket": os.environ["BUCKET"],
                        "key": key,
                    },
                    "location": "S3",
                    "title": f"Summary: {filename}",
                }
            )

        return {"results": [{"input_reference": None, "outputs": outputs}]}

    except Exception:
        logger.exception("Error in lambda execution")
        raise
