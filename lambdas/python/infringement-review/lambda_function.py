import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import (
    DECISION_DETERMINATION_PROMPT,
    EVIDENCE_ANALYSIS_PROMPT,
    HUMAN_ERROR_ANALYSIS_PROMPT,
    LEGISLATION_EVALUATION_PROMPT,
    PARKING_LEGISLATION,
    RESPONSE_LETTER_PROMPT,
)

MAX_TOKENS = 4096

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)
    try:
        input_key = event["input_key"]
        infringement_details = event["infringement_details"]

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
        )

        # Step 2: Human Error Analysis
        logger.info("Starting human error analysis")
        human_error_analysis = get_model_response(
            prompt=HUMAN_ERROR_ANALYSIS_PROMPT,
            input_data={
                "evidence_content": evidence_content,
                "infringement_details": infringement_details,
            },
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
        )

        logger.info("Completed infringement review")

        results = {
            "evidence_analysis": evidence_analysis,
            "human_error_analysis": human_error_analysis,
            "legislation_evaluation": legislation_evaluation,
            "decision_determination": decision_determination,
            "response_letter": response_letter,
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
    response = model.run(query=formatted_prompt, name_for_logging="infringement_review")

    if isinstance(response.response, list) and response.response:
        if isinstance(response.response[0], dict):
            markdown_text = response.response[0].get("text", "")
            return markdown_text.replace("`", "")
    return str(response.response).replace("`", "")
