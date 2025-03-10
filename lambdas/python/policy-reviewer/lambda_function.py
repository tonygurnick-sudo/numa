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


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)
    try:
        input_key = event["input_key"]
        legislation_content = event["legislation_content"]
        policy_context = event["policy_context"]

        policy_content = s3_helpers.read(input_key)

        initial_analysis = get_model_response(
            prompt=INITIAL_ANALYSIS_PROMPT,
            input_data={
                "policy_content": policy_content,
                "policy_context": policy_context,
            },
        )

        policy_review = get_model_response(
            prompt=POLICY_REVIEW_PROMPT,
            input_data={
                "policy_content": policy_content,
                "initial_analysis": initial_analysis,
                "legislation_content": legislation_content,
            },
        )

        recommended_updates = get_model_response(
            prompt=RECOMMENDED_UPDATES_PROMPT,
            input_data={
                "policy_content": policy_content,
                "policy_review": policy_review,
            },
        )

        updated_policy = get_model_response(
            prompt=UPDATED_POLICY_PROMPT,
            input_data={
                "policy_content": policy_content,
                "recommended_updates": recommended_updates,
            },
        )

        results = {
            "initial_analysis": initial_analysis,
            "policy_review": policy_review,
            "recommended_updates": recommended_updates,
            "updated_policy": updated_policy,
        }

        return results

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
