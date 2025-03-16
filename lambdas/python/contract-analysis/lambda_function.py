import json
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
        output_key = event["output_key"]
        contract_context = event.get("contract_context", "")

        contract_content = s3_helpers.read(input_key)

        # Step 1: Clause Identification
        identified_clauses = get_model_response(
            prompt=CLAUSE_IDENTIFICATION_PROMPT,
            input_data={
                "contract_content": contract_content,
                "contract_context": contract_context,
            },
        )

        # Step 2: Highlighting & Explanation
        highlighted_explanations = get_model_response(
            prompt=HIGHLIGHTING_EXPLANATION_PROMPT,
            input_data={
                "contract_content": contract_content,
                "contract_context": contract_context,
                "identified_clauses": identified_clauses,
            },
        )

        # Step 3: Risk Assessment (combined risk detection and scoring)
        risk_assessment = get_model_response(
            prompt=RISK_ASSESSMENT_PROMPT,
            input_data={
                "contract_content": contract_content,
                "contract_context": contract_context,
                "highlighted_explanations": highlighted_explanations,
            },
        )

        # Step 4: Improvement Suggestions
        improvement_suggestions = get_model_response(
            prompt=IMPROVEMENT_SUGGESTIONS_PROMPT,
            input_data={
                "contract_content": contract_content,
                "contract_context": contract_context,
                "risk_assessment": risk_assessment,
            },
        )

        results = {
            "identified_clauses": identified_clauses,
            "highlighted_explanations": highlighted_explanations,
            "risk_assessment": risk_assessment,
            "improvement_suggestions": improvement_suggestions,
        }

        results_json = json.dumps(results, indent=2).encode("utf-8")
        s3_helpers.write(output_key, results_json, content_type="application/json")

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
                            "title": "Contract Analysis",
                        },
                    ],
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
