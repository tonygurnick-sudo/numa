import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from bedrock.language import get_language_system_prompt
from prompts import (
    DRAFT_POLICY_PROMPT,
    LEGISLATIVE_REVIEW_PROMPT,
    TEMPLATE_GENERATION_PROMPT,
)
from tools import POLICY_GENERATION_TOOL

MAX_TOKENS = 16000

logger = structlog.get_logger(__name__)


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)
    try:
        additional_instructions = event["additional_instructions"]
        legislation_content = event["legislation_content"]
        policy_context = event["policy_context"]
        extracted_example_policy_key = event["extracted_example_policy_key"]

        output_path = event["output_path"]
        language = event.get("language")

        example_policy_content = b""
        if extracted_example_policy_key:
            example_policy_content = s3_helpers.read(extracted_example_policy_key)

        generated_template = _get_model_response(
            prompt=TEMPLATE_GENERATION_PROMPT,
            input_data={
                "policy_context": policy_context,
                "additional_instructions": additional_instructions,
            },
            language=language,
        )

        outputs: list[
            helpers.AppOutputResultInlineOutput | helpers.AppOutputResulS3Output
        ] = []
        draft_policy_key = "/".join([output_path, "draft_policy.md"])
        draft_policy = _get_model_response(
            prompt=DRAFT_POLICY_PROMPT,
            input_data={
                "policy_context": policy_context,
                "additional_instructions": additional_instructions,
                "example_template": example_policy_content.decode("utf-8"),
                "generated_template": generated_template,
            },
            language=language,
        )
        s3_helpers.write(draft_policy_key, draft_policy.encode("utf-8"))
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": draft_policy_key,
                },
                "location": "S3",
                "title": "Draft Policy",
            }
        )

        legislative_review = ""
        legislative_review_key = "/".join([output_path, "legislative_review.md"])
        if legislation_content:
            legislative_review = _get_model_response(
                prompt=LEGISLATIVE_REVIEW_PROMPT,
                input_data={
                    "policy_context": policy_context,
                    "draft_policy": draft_policy,
                    "legislation_content": legislation_content,
                },
                language=language,
            )
            s3_helpers.write(legislative_review_key, legislative_review.encode("utf-8"))
            outputs.append(
                {
                    "content_type": "text/markdown",
                    "data": {
                        "bucket": os.environ["BUCKET"],
                        "key": legislative_review_key,
                    },
                    "location": "S3",
                    "title": "Legislative Review",
                },
            )

        logger.info("Policy generation completed")

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": outputs,
                }
            ]
        }

    except Exception:
        logger.exception("Policy generation failed")
        raise


def _get_model_response(
    prompt: str, input_data: dict[str, str], language: str | None = None
) -> str:
    """Get response from the model."""
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
            "tools": POLICY_GENERATION_TOOL,
            "tool_choice": {"type": "tool", "name": "policy_content"},
        },
        system_prompt=system_prompt,
    )

    formatted_prompt = prompt.format(**input_data)
    response = model.run(query=formatted_prompt, name_for_logging="policy_drafter")

    if isinstance(response.response, list) and response.response:
        if isinstance(response.response[0], dict):
            content = response.response[0]["input"]["content"]
            return content.replace("`", "")
    return ""
