import json

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import USER_PROFILE_PROMPT
from tools import USER_PROFILE_TOOL

MAX_TOKENS = 4096
logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> dict:
    """
    Lambda function to create a structured company profile.
    """
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        details = event["details"]
        about = event.get("about", "")
        docs_key = event.get("documentation_text")
        documentation_text = s3_helpers.read(docs_key) if docs_key else ""

        input_data = {
            "details": details,
            "about": about,
            "file_content": documentation_text,
        }

        profile = _create_profile(input_data)

        name = (
            profile.get("profile_details", {})
            .get("name", "unknown")
            .replace(" ", "_")
            .lower()
        )
        output_key = f"profiles/{name}_profile.json"

        profile_json = json.dumps(profile, indent=2).encode("utf-8")
        s3_helpers.write(output_key, profile_json, content_type="application/json")

        return {"output_key": output_key}

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def _create_profile(input_data: dict) -> dict:
    """
    Calls the Bedrock model using an anthropic tool to generate a structured profile.
    """
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
            "tools": USER_PROFILE_TOOL,
            "tool_choice": {"type": "tool", "name": "create_profile"},
        }
    )

    formatted_prompt = USER_PROFILE_PROMPT.format(
        details=input_data["details"],
        about=input_data["about"],
        file_content=input_data["file_content"],
    )

    response = model.run(
        query=formatted_prompt, name_for_logging="user_profile_creation"
    )

    result = response.response[0]["input"]
    return {**result, "metadata": response.metadata}
