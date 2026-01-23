import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from bedrock.language import get_language_system_prompt
from prompts import ELIGIBILITY_ASSESSMENT_PROMPT, RFP_ASSESSMENT_PROMPT

MAX_TOKENS = 16000

logger = structlog.get_logger()


def remove_backticks(text: str) -> str:
    """Remove all backticks from a string."""
    return text.replace("`", "")


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        input_key = event["input_key"]
        rfp_reference_key = event["rfp_reference_key"]
        assessment_instructions = event.get("assessment_instructions", "")
        output_path = event["output_path"]
        language = event.get("language")

        # Read document content from S3
        application_bytes = s3_helpers.read(input_key)
        application_content = application_bytes.decode("utf-8")

        rfp_reference_bytes = s3_helpers.read(rfp_reference_key)
        rfp_reference_content = rfp_reference_bytes.decode("utf-8")

        # Generate eligibility assessment
        eligibility_assessment = _assess_eligibility(
            application_content,
            rfp_reference_content,
            assessment_instructions,
            language,
        )
        eligibility_assessment = remove_backticks(eligibility_assessment)
        eligibility_output_key = f"{output_path}/eligibility_assessment.md"
        s3_helpers.write(
            eligibility_output_key,
            eligibility_assessment.encode("utf-8"),
            content_type="text/markdown",
        )

        # Generate full RFP assessment
        rfp_assessment = _assess_rfp(
            application_content,
            rfp_reference_content,
            eligibility_assessment,
            assessment_instructions,
            language,
        )
        rfp_assessment = remove_backticks(rfp_assessment)
        rfp_output_key = f"{output_path}/rfp_assessment.md"
        s3_helpers.write(
            rfp_output_key, rfp_assessment.encode("utf-8"), content_type="text/markdown"
        )

        logger.info("Completed RFP assessment")

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": eligibility_output_key,
                            },
                            "location": "S3",
                            "title": "Eligibility Assessment",
                        },
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": rfp_output_key,
                            },
                            "location": "S3",
                            "title": "RFP Assessment",
                        },
                    ],
                },
            ]
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def _assess_eligibility(
    application_content: str,
    rfp_reference_content: str,
    assessment_instructions: str,
    language: str | None = None,
) -> str:
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        },
        system_prompt=system_prompt,
    )

    formatted_prompt = ELIGIBILITY_ASSESSMENT_PROMPT.format(
        application_content=application_content,
        rfp_reference_content=rfp_reference_content,
        assessment_instructions=assessment_instructions,
    )

    response = model.run(
        query=formatted_prompt, name_for_logging="eligibility_assessment"
    )

    return response.response[0]["text"]


def _assess_rfp(
    application_content: str,
    rfp_reference_content: str,
    eligibility_assessment: str,
    assessment_instructions: str,
    language: str | None = None,
) -> str:
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        },
        system_prompt=system_prompt,
    )

    formatted_prompt = RFP_ASSESSMENT_PROMPT.format(
        application_content=application_content,
        rfp_reference_content=rfp_reference_content,
        eligibility_assessment=eligibility_assessment,
        assessment_instructions=assessment_instructions,
    )

    response = model.run(query=formatted_prompt, name_for_logging="rfp_assessment")

    return response.response[0]["text"]
