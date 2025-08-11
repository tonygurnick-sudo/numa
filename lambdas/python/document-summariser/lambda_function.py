import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import DOCUMENT_SUMMARY_PROMPT
from tools import DOCUMENT_SUMMARY_TOOL

MAX_TOKENS = 16000

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        input_key = event["input_key"]
        output_key = event["output_key"]

        input_data = {
            "document_content": s3_helpers.read(input_key),
            "focus_area": event.get("focus_area", "General summary"),
            "summary_level": event.get("summary_level", "detailed"),
        }

        summary = _summarise(input_data)["markdown_summary"].encode("utf-8")
        s3_helpers.write(output_key, summary, content_type="text/markdown")

        return {"output_key": output_key}

    except Exception:
        logger.exception("Error in lambda execution")
        raise


def _summarise(input_data: dict) -> dict:
    model = bedrock.BedrockClaude3Model(
        model_args={
            "max_tokens": MAX_TOKENS,
            "temperature": 0.1,
            "tools": DOCUMENT_SUMMARY_TOOL,
            "tool_choice": {"type": "tool", "name": "summarize_document"},
        }
    )

    formatted_prompt = DOCUMENT_SUMMARY_PROMPT.format(
        document_content=input_data["document_content"],
        focus_area=input_data["focus_area"],
        summary_level=input_data["summary_level"],
    )

    response = model.run(
        query=formatted_prompt, name_for_logging="document_summarization"
    )

    result = response.response[0]["input"]
    return {**result, "metadata": response.metadata}
