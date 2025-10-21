import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import (
    ASSESSMENT_EXAMPLE,
    ASSESSMENT_TEMPLATE,
    GDSR_ASSESSMENT_PROMPT,
    GDSR_REFERENCE,
)

MAX_TOKENS = 16000

logger = structlog.get_logger()


def remove_backticks(text: str) -> str:
    """Remove all backticks from a string."""
    return text.replace("`", "")


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        input_key = event["input_key"]
        supporting_data_key = event.get("supporting_data_key")
        output_key = event["output_key"]

        document_bytes = s3_helpers.read(input_key)
        document_content = document_bytes.decode("utf-8")

        supporting_data_content = ""
        if supporting_data_key:
            supporting_data_bytes = s3_helpers.read(supporting_data_key)
            supporting_data_content = supporting_data_bytes.decode("utf-8")
            logger.info(
                "Supporting data loaded", supporting_data_key=supporting_data_key
            )
        else:
            logger.info("No supporting data provided")

        assessment = _assess(document_content, supporting_data_content)
        assessment = remove_backticks(assessment)
        s3_helpers.write(
            output_key, assessment.encode("utf-8"), content_type="text/markdown"
        )

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": output_key,
                            },
                            "location": "S3",
                            "title": "GDSR Assessment",
                        }
                    ],
                },
            ]
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def _assess(document_content: str, supporting_data_content: str = "") -> str:
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        }
    )

    formatted_prompt = GDSR_ASSESSMENT_PROMPT.format(
        document_content=document_content,
        supporting_data_content=supporting_data_content,
        gdsr_reference=GDSR_REFERENCE,
        assessment_template=ASSESSMENT_TEMPLATE,
        assessment_example=ASSESSMENT_EXAMPLE,
    )

    response = model.run(query=formatted_prompt, name_for_logging="gdsr_assessment")

    return response.response[0]["text"]
