import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import (
    TOR_ASSESSMENT_PROMPT,
    TOR_ASSESSMENT_TEMPLATE,
    TOR_SUGGESTIONS_PROMPT,
    TOR_SUGGESTIONS_TEMPLATE,
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
        assessment_output_key = event["assessment_output_key"]
        suggestions_output_key = event["suggestions_output_key"]

        document_bytes = s3_helpers.read(input_key)
        document_content = document_bytes.decode("utf-8")

        # Generate assessment first
        assessment = _assess_tor(document_content)

        # Generate suggestions based on the assessment
        suggestions = _generate_suggestions(document_content, assessment)

        # Clean up any markdown formatting issues
        assessment = remove_backticks(assessment)
        suggestions = remove_backticks(suggestions)

        # Write both outputs to S3
        s3_helpers.write(
            assessment_output_key,
            assessment.encode("utf-8"),
            content_type="text/markdown",
        )
        s3_helpers.write(
            suggestions_output_key,
            suggestions.encode("utf-8"),
            content_type="text/markdown",
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
                                "key": assessment_output_key,
                            },
                            "location": "S3",
                            "title": "ToR Assessment",
                        },
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": suggestions_output_key,
                            },
                            "location": "S3",
                            "title": "ToR Suggested Changes",
                        },
                    ],
                },
            ]
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def _assess_tor(document_content: str) -> str:
    """Generate the comprehensive ToR assessment using the template."""
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        }
    )

    formatted_prompt = TOR_ASSESSMENT_PROMPT.format(
        document_content=document_content,
        assessment_template=TOR_ASSESSMENT_TEMPLATE,
    )

    response = model.run(query=formatted_prompt, name_for_logging="tor_assessment")

    return response.response[0]["text"]


def _generate_suggestions(document_content: str, assessment: str) -> str:
    """Generate the suggested changes based on the assessment findings."""
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        }
    )

    formatted_prompt = TOR_SUGGESTIONS_PROMPT.format(
        document_content=document_content,
        assessment_findings=assessment,
        suggestions_template=TOR_SUGGESTIONS_TEMPLATE,
    )

    response = model.run(query=formatted_prompt, name_for_logging="tor_suggestions")

    return response.response[0]["text"]
