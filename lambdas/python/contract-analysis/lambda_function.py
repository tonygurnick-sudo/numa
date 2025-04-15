import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import (
    CLAUSE_IDENTIFICATION_PROMPT,
    HIGHLIGHTING_EXPLANATION_PROMPT,
    IMPROVEMENT_SUGGESTIONS_PROMPT,
    RISK_ASSESSMENT_PROMPT,
)

MAX_TOKENS = 4096

logger = structlog.get_logger()


def remove_backticks(text: str) -> str:
    """Remove all backticks from a string."""
    return text.replace("`", "")


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    helpers.setup_step_function_lambda_logging(event, context)
    try:
        input_key = event["input_key"]
        output_path = event["output_path"]
        contract_context = event.get("contract_context", "")

        # Create outputs array for each file
        outputs: list[
            helpers.AppOutputResultInlineOutput | helpers.AppOutputResulS3Output
        ] = []

        contract_content = s3_helpers.read(input_key)

        # Step 1: Clause Identification
        logger.info("Generating clause identification")
        identified_clauses = get_model_response(
            prompt=CLAUSE_IDENTIFICATION_PROMPT,
            input_data={
                "contract_content": contract_content,
                "contract_context": contract_context,
            },
        )

        # Save clause identification as markdown
        identified_clauses_key = f"{output_path}/identified_clauses.md"
        s3_helpers.write(
            identified_clauses_key,
            identified_clauses.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": identified_clauses_key,
                },
                "location": "S3",
                "title": "Identified Clauses",
            }
        )

        # Step 2: Highlighting & Explanation
        logger.info("Generating highlighting and explanation")
        highlighted_explanations = get_model_response(
            prompt=HIGHLIGHTING_EXPLANATION_PROMPT,
            input_data={
                "contract_content": contract_content,
                "contract_context": contract_context,
                "identified_clauses": identified_clauses,
            },
        )

        # Save highlighting & explanation as markdown
        highlighted_explanations_key = f"{output_path}/highlighted_explanations.md"
        s3_helpers.write(
            highlighted_explanations_key,
            highlighted_explanations.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": highlighted_explanations_key,
                },
                "location": "S3",
                "title": "Highlighted Explanations",
            }
        )

        # Step 3: Risk Assessment (combined risk detection and scoring)
        logger.info("Generating risk assessment")
        risk_assessment = get_model_response(
            prompt=RISK_ASSESSMENT_PROMPT,
            input_data={
                "contract_content": contract_content,
                "contract_context": contract_context,
                "highlighted_explanations": highlighted_explanations,
            },
        )

        # Save risk assessment as markdown
        risk_assessment_key = f"{output_path}/risk_assessment.md"
        s3_helpers.write(
            risk_assessment_key,
            risk_assessment.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": risk_assessment_key,
                },
                "location": "S3",
                "title": "Risk Assessment",
            }
        )

        # Step 4: Improvement Suggestions
        logger.info("Generating improvement suggestions")
        improvement_suggestions = get_model_response(
            prompt=IMPROVEMENT_SUGGESTIONS_PROMPT,
            input_data={
                "contract_content": contract_content,
                "contract_context": contract_context,
                "risk_assessment": risk_assessment,
            },
        )

        # Save improvement suggestions as markdown
        improvement_suggestions_key = f"{output_path}/improvement_suggestions.md"
        s3_helpers.write(
            improvement_suggestions_key,
            improvement_suggestions.encode("utf-8"),
            content_type="text/markdown",
        )
        outputs.append(
            {
                "content_type": "text/markdown",
                "data": {
                    "bucket": os.environ["BUCKET"],
                    "key": improvement_suggestions_key,
                },
                "location": "S3",
                "title": "Improvement Suggestions",
            }
        )

        logger.info("Completed contract analysis")

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
    response = model.run(query=formatted_prompt, name_for_logging="contract_analysis")

    if isinstance(response.response, list) and response.response:
        if isinstance(response.response[0], dict):
            markdown_text = response.response[0].get("text", "")
            return remove_backticks(markdown_text)
    return remove_backticks(str(response.response))
