import json

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import helpers
import s3_helpers
from prompts import PERSONAL_FINANCE_PROMPT
from tools import PERSONAL_FINANCE_TOOLS

MAX_TOKENS = 4096
MAX_PAGES = 60

logger = structlog.get_logger()


def handler(event: dict, context: LambdaContext) -> dict:
    helpers.setup_step_function_lambda_logging(event, context)

    try:
        input_key = event["input_key"]
        output_key = event["output_key"]

        extracted_content = json.loads(s3_helpers.read(input_key))
        pages = extracted_content["pages"][:MAX_PAGES]

        result: list[dict] = [field for page in pages for field in __run_model(page)]

        s3_helpers.write(
            output_key,
            json.dumps(result).encode("utf-8"),
            content_type="application/json",
        )
        return {"output_key": output_key}
    except Exception:
        logger.exception("Error in lambda execution")
        raise


def __run_model(extracted_content: dict) -> list[dict]:
    model = bedrock.BedrockClaude3Model(
        model_args={
            "tools": PERSONAL_FINANCE_TOOLS,
            "tool_choice": {"type": "tool", "name": "print_data"},
            "max_tokens": MAX_TOKENS,
        },
        claude_only=True,
    )

    prompt = PERSONAL_FINANCE_PROMPT.format(document=extracted_content)
    data = model.run(prompt).response[0]["input"]["data"]

    if isinstance(data, list):
        return data

    return json.loads(data.replace("<UNKNOWN>", '"unknown"'))
