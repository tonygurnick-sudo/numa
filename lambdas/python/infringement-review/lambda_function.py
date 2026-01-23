import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from bedrock.language import get_language_system_prompt
from prompts import (
    DECISION_DETERMINATION_PROMPT,
    EVIDENCE_ANALYSIS_PROMPT,
    HUMAN_ERROR_ANALYSIS_PROMPT,
    LEGISLATION_EVALUATION_PROMPT,
    PARKING_LEGISLATION,
    RESPONSE_LETTER_PROMPT,
)

MAX_TOKENS = 16000

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)
    try:
        input_key = event["input_key"]
        output_path = event["output_path"]
        infringement_details = event["infringement_details"]
        language = event.get("language")

        # Create outputs array for each file
        outputs: list[
            helpers.AppOutputResultInlineOutput | helpers.AppOutputResulS3Output
        ] = []

        logger.info(
            "Processing infringement review",
            input_key=input_key,
            infringement_details_length=len(infringement_details),
        )

        # Read evidence content
        evidence_content = s3_helpers.read(input_key)
        logger.info(
            "Read evidence file",
            file_key=input_key,
            content_length=len(evidence_content),
        )

        # Step 1: Evidence Analysis
        logger.info("Starting evidence analysis")
        evidence_analysis = get_model_response(
            prompt=EVIDENCE_ANALYSIS_PROMPT,
            input_data={
                "evidence_content": evidence_content,
                "infringement_details": infringement_details,
            },
            language=language,
        )

        # Save evidence analysis as markdown
        evidence_analysis_key = f"{output_path}/evidence_analysis.md"
        s3_helpers.write(
            evidence_analysis_key,
            evidence_analysis.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": evidence_analysis_key,
                },
                "location": "S3",
                "title": "Evidence Analysis",
            }
        )

        # Step 2: Human Error Analysis
        logger.info("Starting human error analysis")
        human_error_analysis = get_model_response(
            prompt=HUMAN_ERROR_ANALYSIS_PROMPT,
            input_data={
                "evidence_content": evidence_content,
                "infringement_details": infringement_details,
            },
            language=language,
        )

        # Save human error analysis as markdown
        human_error_analysis_key = f"{output_path}/human_error_analysis.md"
        s3_helpers.write(
            human_error_analysis_key,
            human_error_analysis.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": human_error_analysis_key,
                },
                "location": "S3",
                "title": "Human Error Analysis",
            }
        )

        # Step 3: Legislation Evaluation
        logger.info("Starting legislation evaluation")
        legislation_evaluation = get_model_response(
            prompt=LEGISLATION_EVALUATION_PROMPT,
            input_data={
                "evidence_analysis": evidence_analysis,
                "human_error_analysis": human_error_analysis,
                "legislation_content": PARKING_LEGISLATION,
            },
            language=language,
        )

        # Save legislation evaluation as markdown
        legislation_evaluation_key = f"{output_path}/legislation_evaluation.md"
        s3_helpers.write(
            legislation_evaluation_key,
            legislation_evaluation.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": legislation_evaluation_key,
                },
                "location": "S3",
                "title": "Legislation Evaluation",
            }
        )

        # Step 4: Decision Determination
        logger.info("Determining decision")
        decision_determination = get_model_response(
            prompt=DECISION_DETERMINATION_PROMPT,
            input_data={
                "evidence_analysis": evidence_analysis,
                "human_error_analysis": human_error_analysis,
                "legislation_comparison": legislation_evaluation,
            },
            language=language,
        )

        # Save decision determination as markdown
        decision_determination_key = f"{output_path}/decision_determination.md"
        s3_helpers.write(
            decision_determination_key,
            decision_determination.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": decision_determination_key,
                },
                "location": "S3",
                "title": "Decision Determination",
            }
        )

        # Step 5: Generate Response Letter
        logger.info("Generating response letter")
        response_letter = get_model_response(
            prompt=RESPONSE_LETTER_PROMPT,
            input_data={
                "infringement_details": infringement_details,
                "decision_determination": decision_determination,
                "evidence_analysis": evidence_analysis,
                "human_error_analysis": human_error_analysis,
                "legislation_comparison": legislation_evaluation,
            },
            language=language,
        )

        # Save response letter as markdown
        response_letter_key = f"{output_path}/response_letter.md"
        s3_helpers.write(
            response_letter_key,
            response_letter.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": response_letter_key,
                },
                "location": "S3",
                "title": "Response Letter",
            }
        )

        logger.info("Completed infringement review")

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


def get_model_response(
    prompt: str, input_data: dict, language: str | None = None
) -> str:
    """Get response from the model."""
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        },
        system_prompt=system_prompt,
    )

    formatted_prompt = prompt.format(**input_data)
    response = model.run(query=formatted_prompt, name_for_logging="infringement_review")

    if isinstance(response.response, list) and response.response:
        if isinstance(response.response[0], dict):
            markdown_text = response.response[0].get("text", "")
            return markdown_text.replace("`", "")
    return str(response.response).replace("`", "")
