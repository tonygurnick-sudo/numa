import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import (
    INITIAL_ANALYSIS_PROMPT,
    POLICY_REVIEW_PROMPT,
    RECOMMENDED_UPDATES_PROMPT,
    UPDATED_POLICY_PROMPT,
)

MAX_TOKENS = 4096

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)
    try:
        input_key = event["input_key"]
        legislation_content = event["legislation_content"]
        policy_context = event["policy_context"]
        output_path = event["output_path"]

        logger.info("Reading policy content")
        policy_content = s3_helpers.read(input_key)

        outputs: list[
            helpers.AppOutputResultInlineOutput | helpers.AppOutputResulS3Output
        ] = []

        logger.info("Generating initial analysis")
        initial_analysis = get_model_response(
            prompt=INITIAL_ANALYSIS_PROMPT,
            input_data={
                "policy_content": policy_content,
                "policy_context": policy_context,
            },
        )

        # Save initial analysis as markdown
        initial_analysis_key = f"{output_path}/initial_analysis.md"
        s3_helpers.write(
            initial_analysis_key,
            initial_analysis.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": initial_analysis_key,
                },
                "location": "S3",
                "title": "Initial Analysis",
            }
        )

        logger.info("Generating policy review")
        policy_review = get_model_response(
            prompt=POLICY_REVIEW_PROMPT,
            input_data={
                "policy_content": policy_content,
                "initial_analysis": initial_analysis,
                "legislation_content": legislation_content,
            },
        )

        # Save policy review as markdown
        policy_review_key = f"{output_path}/policy_review.md"
        s3_helpers.write(
            policy_review_key,
            policy_review.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": policy_review_key,
                },
                "location": "S3",
                "title": "Policy Review",
            }
        )

        logger.info("Generating recommended updates")
        recommended_updates = get_model_response(
            prompt=RECOMMENDED_UPDATES_PROMPT,
            input_data={
                "policy_content": policy_content,
                "policy_review": policy_review,
            },
        )

        # Save recommended updates as markdown
        recommended_updates_key = f"{output_path}/recommended_updates.md"
        s3_helpers.write(
            recommended_updates_key,
            recommended_updates.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": recommended_updates_key,
                },
                "location": "S3",
                "title": "Recommended Updates",
            }
        )

        logger.info("Generating updated policy")
        updated_policy = get_model_response(
            prompt=UPDATED_POLICY_PROMPT,
            input_data={
                "policy_content": policy_content,
                "recommended_updates": recommended_updates,
            },
        )

        # Save updated policy as markdown
        updated_policy_key = f"{output_path}/updated_policy.md"
        s3_helpers.write(
            updated_policy_key,
            updated_policy.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": updated_policy_key,
                },
                "location": "S3",
                "title": "Updated Policy",
            }
        )

        logger.info("Completed policy review")

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": outputs,
                },
            ]
        }

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def get_model_response(prompt: str, input_data: dict) -> str:
    """Get response from the model."""
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        }
    )

    formatted_prompt = prompt.format(**input_data)
    response = model.run(query=formatted_prompt, name_for_logging="policy_review")

    if isinstance(response.response, list) and response.response:
        if isinstance(response.response[0], dict):
            markdown_text = response.response[0].get("text", "")
            return markdown_text.replace("`", "")
    return str(response.response).replace("`", "")
