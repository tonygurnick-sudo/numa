import json
import os

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from bedrock.language import get_language_system_prompt
from prompts import COMPARISON_PROMPT
from tools import COMPARISON_TOOL

# Maximum tokens for LLM
MAX_TOKENS = 16000
logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)
    try:
        bucket = os.environ["BUCKET"]
        # list of S3 keys for extracted texts
        extracted_keys = event["extracted_keys"]
        framework_key = event["framework"]
        language = event.get("language")

        # Process each extracted response
        responses_text = []
        for idx, key in enumerate(extracted_keys):
            try:
                # Read and parse the response JSON
                content_bytes = s3_helpers.read(key)
                content = content_bytes.decode("utf-8", errors="ignore")
                data = json.loads(content)

                # Aggregate all page texts
                text = "\n\n".join(
                    page.get("text", "") for page in data.get("pages", [])
                )
                responses_text.append(f"--- Response {idx+1} ---\n{text}")
            except Exception as e:
                logger.error("Failed to process response", key=key, error=str(e))
                responses_text.append(
                    f"--- Response {idx+1} ---\nError processing response"
                )

        responses_block = "\n\n".join(responses_text)

        # Read framework document
        framework_bytes = s3_helpers.read(framework_key)
        framework = framework_bytes.decode("utf-8", errors="ignore")

        # Build prompt with extracted responses
        prompt = COMPARISON_PROMPT.format(
            summaries=responses_block, framework=framework
        )

        # Invoke Bedrock LLM
        system_prompt = get_language_system_prompt(language)
        model = bedrock.BedrockClaude3Model(
            model_args={
                "max_tokens": MAX_TOKENS,
                "temperature": 0.1,
                "tools": COMPARISON_TOOL,
                "tool_choice": {"type": "tool", "name": "compare_rfp_responses"},
            },
            system_prompt=system_prompt,
        )
        response = model.run(query=prompt, name_for_logging="rfp_comparison")

        # Extract the result with better error handling for different response formats
        result = ""
        if (
            response.response
            and isinstance(response.response, list)
            and len(response.response) > 0
        ):
            first_item = response.response[0]

            # Try to extract from tool format
            if isinstance(first_item, dict) and "input" in first_item:
                input_data = first_item["input"]
                if isinstance(input_data, dict) and "comparison" in input_data:
                    result = input_data["comparison"]
                else:
                    logger.warning(
                        "Input field exists but comparison key not found",
                        input_keys=(
                            list(input_data.keys())
                            if isinstance(input_data, dict)
                            else "not a dict"
                        ),
                    )

            # Fallback to text content if tool format fails
            if not result and isinstance(first_item, dict) and "text" in first_item:
                result = first_item["text"]
                logger.info("Extracted text from direct response")
            elif (
                not result and isinstance(first_item, dict) and "content" in first_item
            ):
                result = first_item["content"]
                logger.info("Extracted content from response")

        # If still no result, try to use the entire response as a fallback
        if not result:
            logger.warning("Could not extract structured result, using full response")
            result = str(response.response)

        # Save comparison result to S3 as Markdown
        output_key = f"{event['output_path']}/comparison.md"
        # Strip markdown code fences
        if isinstance(result, str):
            cleaned = result.replace("```", "")
        else:
            cleaned = str(result)
        s3_helpers.write(
            output_key, cleaned.encode("utf-8"), content_type="text/markdown"
        )

        return {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": bucket,
                                "key": output_key,
                            },
                            "location": "S3",
                            "title": "RFP Response Comparison",
                        }
                    ],
                }
            ]
        }
    except Exception:
        logger.exception("Error in RFP response comparison")
        raise
