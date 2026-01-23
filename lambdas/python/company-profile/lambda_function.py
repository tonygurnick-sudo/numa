import json
import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from bedrock.language import get_language_system_prompt
from prompts import USER_PROFILE_PROMPT
from tools import USER_PROFILE_TOOL

MAX_TOKENS = 16000
logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    """
    Lambda function to create a structured company profile.
    """
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        about = event["about"]
        contact_information = event["contact_information"]
        input_keys = event["input_keys"]
        file_content = "\n\n".join(
            s3_helpers.read(key).decode("utf-8") for key in input_keys
        )
        output_key = event["output_key"]
        language = event.get("language")

        profile = _create_profile(about, contact_information, file_content, language)

        profile_json = json.dumps(profile, indent=2).encode("utf-8")
        s3_helpers.write(output_key, profile_json, content_type="application/json")

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "application/json",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": output_key,
                            },
                            "location": "S3",
                            "title": "Company Profile",
                        },
                    ],
                },
            ]
        }
    except Exception:
        logger.exception("Error in lambda execution")
        raise


def _create_profile(
    about: str, contact_information: str, file_content: str, language: str | None = None
) -> dict:
    """
    Calls the Bedrock model using an anthropic tool to generate a structured profile.
    """
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
            "tools": USER_PROFILE_TOOL,
            "tool_choice": {"type": "tool", "name": "create_profile"},
        },
        system_prompt=system_prompt,
    )

    formatted_prompt = USER_PROFILE_PROMPT.format(
        about=about,
        contact_information=contact_information,
        file_content=file_content,
    )

    response = model.run(
        query=formatted_prompt, name_for_logging="user_profile_creation"
    )

    result = response.response[0]["input"]
    return {**result, "metadata": response.metadata}
