import json
import os
from typing import Any, Dict

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from bedrock.language import get_language_system_prompt
from costing_engine import get_costing_engine
from prompts import CALCULATION_DETAIL_PROMPT, QUOTE_GENERATION_PROMPT
from tools import PARAMETER_EXTRACTION_TOOL

# Constants
MAX_TOKENS = 16000

logger = structlog.get_logger(__name__)


def remove_backticks(text: str) -> str:
    """Remove all backticks from a string."""
    return text.replace("`", "")


def prepare_input_parameters(specifications: dict) -> str:
    """
    Prepare the specifications from the dropdown table for the extraction tool.
    """
    return "Specifications: " + str(specifications)


def handler(event: dict, context: LambdaContext) -> helpers.AppOutput:
    """Main Lambda handler for cost calculations."""
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        job_id = event.get("job_id", "")
        specifications = event.get("specifications", {})
        output_key = event.get("output_key", "")
        detail_output_key = output_key.replace(".json", "-details.md")
        quote_output_key = output_key.replace(".json", "-quote.md")
        language = event.get("language")

        logger.info(
            "Processing costing calculation",
            job_id=job_id,
            has_specifications=bool(specifications),
        )
        input_data = prepare_input_parameters(specifications)
        parameters = extract_parameters_with_tool(input_data, language)

        # Step 2: Calculate costs using the appropriate engine
        costing_model = parameters.get("costing_model", "decrashape")
        costing_results = calculate_costs(parameters)
        logger.info(
            "Cost calculation completed",
            costing_model=costing_model,
            total_cost=costing_results.get("total", 0),
        )

        # Step 3: Generate detailed calculation explanation
        calculation_details = generate_calculation_details(
            parameters, costing_results, language
        )
        calculation_details = remove_backticks(calculation_details)
        logger.info(
            "Calculation details generated", details_length=len(calculation_details)
        )

        # Step 4: Generate final quote
        quote = generate_quote(parameters, costing_results, language)
        quote = remove_backticks(quote)
        logger.info("Quote generated", quote_length=len(quote))

        final_results = {
            "parameters": parameters,
            "calculations": costing_results,
            "details": calculation_details,
            "quote": quote,
        }

        results_json = json.dumps(final_results, indent=2).encode("utf-8")
        s3_helpers.write(output_key, results_json, content_type="application/json")

        s3_helpers.write(
            detail_output_key,
            calculation_details.encode("utf-8"),
            content_type="text/markdown",
        )

        s3_helpers.write(
            quote_output_key, quote.encode("utf-8"), content_type="text/markdown"
        )

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
                            "title": "Cost Calculation Results",
                        },
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": detail_output_key,
                            },
                            "location": "S3",
                            "title": "Calculation Details",
                        },
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": os.environ["BUCKET"],
                                "key": quote_output_key,
                            },
                            "location": "S3",
                            "title": "Cost Quote",
                        },
                    ],
                },
            ]
        }

    except ValueError as e:
        logger.error(f"Parameter validation error: {str(e)}")
        raise
    except Exception:
        logger.exception("Cost calculation failed")
        raise


def extract_parameters_with_tool(
    input_text: str, language: str | None = None
) -> Dict[str, Any]:
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
            "tools": [PARAMETER_EXTRACTION_TOOL],
            "tool_choice": {"type": "tool", "name": "extract_parameters"},
        },
        system_prompt=system_prompt,
    )

    try:
        logger.info("Sending parameter extraction request to Bedrock")
        response = model.run(
            query=f"Extract costing parameters from this input:\n\n{input_text}",
            name_for_logging="parameter_extraction",
        )

        if hasattr(response, "response") and isinstance(response.response, list):
            for item in response.response:
                if isinstance(item, dict) and "input" in item:
                    logger.info("Successfully extracted parameters using tool")
                    return item["input"]

        logger.error(
            "Unexpected response format from Bedrock",
            response_type=type(response.response),
        )
        raise ValueError("Could not extract parameters: unexpected response format")

    except Exception as e:
        logger.exception("Error in parameter extraction", exception=str(e))
        raise ValueError(f"Parameter extraction failed: {str(e)}") from e


def calculate_costs(parameters: Dict[str, Any]) -> Dict[str, Any]:
    try:
        costing_model = parameters.get("costing_model", "decrashape")
        logger.info("Using costing model", costing_model=costing_model)
        engine = get_costing_engine(costing_model)
        result = engine.calculate_costs(parameters)
        logger.info(
            "Cost calculation successful",
            total=result.get("total", 0),
            subtotal=result.get("subtotal", 0),
        )
        return result
    except Exception as e:
        logger.exception("Error in cost calculation", exception=str(e))
        raise ValueError(f"Cost calculation failed: {str(e)}") from e


def generate_calculation_details(
    parameters: Dict[str, Any],
    costing_results: Dict[str, Any],
    language: str | None = None,
) -> str:
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        },
        system_prompt=system_prompt,
    )

    try:
        formatted_prompt = CALCULATION_DETAIL_PROMPT.format(
            parameters=json.dumps(parameters, indent=2),
            results=json.dumps(costing_results, indent=2),
        )

        logger.info("Sending calculation detail prompt to Bedrock")
        response = model.run(
            query=formatted_prompt, name_for_logging="calculation_details_generation"
        )

        response_text = ""
        if isinstance(response.response, str):
            response_text = response.response
        elif isinstance(response.response, list) and response.response:
            if isinstance(response.response[0], dict):
                response_text = response.response[0].get("text", "")

        if not response_text:
            raise ValueError("Could not generate calculation details")

        return response_text

    except Exception:
        logger.exception("Error generating calculation details")
        return "Error generating calculation details"


def generate_quote(
    parameters: Dict[str, Any],
    costing_results: Dict[str, Any],
    language: str | None = None,
) -> str:
    system_prompt = get_language_system_prompt(language)
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
        },
        system_prompt=system_prompt,
    )

    try:
        formatted_prompt = QUOTE_GENERATION_PROMPT.format(
            parameters=json.dumps(parameters, indent=2),
            results=json.dumps(costing_results, indent=2),
        )

        logger.info("Sending quote generation prompt to Bedrock")
        response = model.run(
            query=formatted_prompt, name_for_logging="quote_generation"
        )

        response_text = ""
        if isinstance(response.response, str):
            response_text = response.response
        elif isinstance(response.response, list) and response.response:
            if isinstance(response.response[0], dict):
                response_text = response.response[0].get("text", "")

        if not response_text:
            raise ValueError("Could not generate quote")

        return response_text

    except Exception:
        logger.exception("Error generating quote")
        return "Error generating quote"
