import json

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from bedrock.language import get_language_system_prompt
from prompts import CANDIDATE_SCREENING_PROMPT
from tools import CANDIDATE_SCREENING_TOOL

MAX_TOKENS = 16000
logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> None:
    """
    Lambda function to screen a candidate against job requirements.
    """
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        resume_key = event["resume_key"]
        resume_text_key = event["resume_text_s3_key"]
        cover_letter_text_key = event.get("cover_letter_text_s3_key")
        company_profile = event["company_profile"]
        job_requirements = event["job_requirements"]
        app_id = event["app_id"]
        job_id = event["job_id"]
        output_key = event["output_key"]
        language = event.get("language")

        resume_text = s3_helpers.read(resume_text_key)

        cover_letter_text = None
        if cover_letter_text_key:
            try:
                cover_letter_text = s3_helpers.read(cover_letter_text_key)
            except Exception as e:
                logger.warning(f"Failed to read cover letter: {e}")
                cover_letter_text = None

        input_data = {
            "resume_text": resume_text,
            "cover_letter_text": cover_letter_text,
            "company_profile": company_profile,
            "job_requirements": job_requirements,
        }

        screening_results = _screen_candidate(input_data, language)

        final_results = {
            "screening_results": screening_results,
            "resume_key": resume_key,
            "cover_letter_key": event.get("cover_letter_key"),
            "job_id": job_id,
            "app_id": app_id,
        }

        s3_helpers.write(
            output_key,
            json.dumps(final_results).encode("utf-8"),
            content_type="application/json",
        )

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def _screen_candidate(input_data: dict, language: str | None = None) -> dict:
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
            "tools": CANDIDATE_SCREENING_TOOL,
            "tool_choice": {"type": "tool", "name": "analyze_candidate"},
        },
        system_prompt=system_prompt,
    )

    formatted_prompt = CANDIDATE_SCREENING_PROMPT.format(
        company_profile=json.dumps(input_data["company_profile"]),
        job_requirements=json.dumps(input_data["job_requirements"]),
        resume_text=input_data["resume_text"],
        cover_letter_text=(
            input_data["cover_letter_text"]
            if input_data["cover_letter_text"]
            else "No cover letter provided"
        ),
    )

    response = model.run(query=formatted_prompt, name_for_logging="candidate_screening")
    result = response.response[0]["input"]
    return {**result, "metadata": response.metadata}
