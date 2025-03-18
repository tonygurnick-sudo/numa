import json

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import (
    DECISION_DETERMINATION_PROMPT,
    EVIDENCE_ANALYSIS_PROMPT,
    LEGISLATION_COMPARISON_PROMPT,
    RESPONSE_LETTER_PROMPT,
)
from tools import (
    DECISION_TOOL,
    EVIDENCE_ANALYSIS_TOOL,
    LEGISLATION_COMPARISON_TOOL,
    RESPONSE_LETTER_TOOL,
)

MAX_TOKENS = 4096
logger = structlog.get_logger()


PARKING_LEGISLATION = ""


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)
    try:
        input_keys = event["input_keys"]  # Multiple file uploads
        infringement_details = event["infringement_details"]

        # Process all evidence files
        evidence_contents = []
        for key in input_keys:
            content = s3_helpers.read(key)
            evidence_contents.append(content)

        # Combine evidence with separators
        combined_evidence = "\n\n===== NEXT EVIDENCE ITEM =====\n\n".join(
            evidence_contents
        )

        # Step 1: Evidence Analysis
        evidence_analysis = get_model_response_with_tool(
            prompt=EVIDENCE_ANALYSIS_PROMPT,
            input_data={
                "evidence_content": combined_evidence,
                "infringement_details": infringement_details,
            },
            tool=EVIDENCE_ANALYSIS_TOOL,
            tool_name="analyze_evidence",
        )

        # Step 2: Legislation Comparison - use predefined legislation
        legislation_comparison = get_model_response_with_tool(
            prompt=LEGISLATION_COMPARISON_PROMPT,
            input_data={
                "evidence_analysis": json.dumps(evidence_analysis, indent=2),
                "legislation_content": PARKING_LEGISLATION,
            },
            tool=LEGISLATION_COMPARISON_TOOL,
            tool_name="compare_with_legislation",
        )

        # Step 3: Decision Determination
        decision_determination = get_model_response_with_tool(
            prompt=DECISION_DETERMINATION_PROMPT,
            input_data={
                "evidence_analysis": json.dumps(evidence_analysis, indent=2),
                "legislation_comparison": json.dumps(legislation_comparison, indent=2),
            },
            tool=DECISION_TOOL,
            tool_name="determine_decision",
        )

        # Step 4: Generate Response Letter
        response_letter = get_model_response_with_tool(
            prompt=RESPONSE_LETTER_PROMPT,
            input_data={
                "infringement_details": infringement_details,
                "decision_determination": json.dumps(decision_determination, indent=2),
                "evidence_analysis": json.dumps(evidence_analysis, indent=2),
            },
            tool=RESPONSE_LETTER_TOOL,
            tool_name="generate_response_letter",
        )

        # Return all results
        results = {
            "evidence_analysis": evidence_analysis,
            "legislation_comparison": legislation_comparison,
            "decision_determination": decision_determination,
            "response_letter": response_letter.get("letter_content", ""),
        }

        return results

    except Exception as e:
        logger.exception("Error in lambda execution", error=str(e))
        raise


def get_model_response_with_tool(
    prompt: str, input_data: dict, tool: list, tool_name: str
) -> dict:
    """Get structured response from the model using a tool."""
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        }
    )

    formatted_prompt = prompt.format(**input_data)

    response = model.run(
        query=formatted_prompt, tools=tool, name_for_logging="infringement_review"
    )

    # Extract tool use from response
    if response.tool_use:
        for tool_use in response.tool_use:
            if tool_use.get("name") == tool_name:
                return tool_use.get("input", {})

    logger.error("No tool usage found in response", tool_name=tool_name)
    return {}
